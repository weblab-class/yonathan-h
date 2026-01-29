const path = require('path');
require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors({ 
  origin: [
    'https://waypointsite.onrender.com', 
    'http://localhost:3000'
  ] 
}));
// for larger images
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 5000;
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

async function run() {
    try {
        await client.connect();
        const database = client.db('waypoint');
        const quests = database.collection('quests');
        const posts = database.collection('posts');

        // deletes quests 24 hours after
        await quests.createIndex({ "createdAt": 1 }, { expireAfterSeconds: 86400 });

        app.get('/api/quests', async (req, res) => {
            const all = await quests.find({}).toArray();
            res.json(all);
        });

        app.post('/api/quests', async (req, res) => {
            // index can track it
            const newQuest = {
                ...req.body,
                createdAt: new Date() 
            };
            const result = await quests.insertOne(newQuest);
            res.status(201).json({ ...newQuest, _id: result.insertedId });
        });

        app.get('/api/posts', async (req, res) => {
            const all = await posts.find({}).sort({ _id: -1 }).toArray();
            res.json(all);
        });

        app.post('/api/posts', async (req, res) => {
            const result = await posts.insertOne(req.body);
            res.status(201).json({ ...req.body, _id: result.insertedId });
        });

        app.post('/api/posts/:id/comments', async (req, res) => {
            const { username, text } = req.body;
            const newComment = { 
                id: Date.now().toString(),
                username, 
                text, 
                date: new Date(), 
                replies: [] 
            };

            await posts.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $push: { comments: newComment } }
            );
            const updatedPost = await posts.findOne({ _id: new ObjectId(req.params.id) });
            res.json(updatedPost);
        });

        // leaderboard stats
        app.get('/api/leaderboard', async (req, res) => {
            const database = client.db('waypoint');
            
            // counts posts with at least 1 verification
            const completionStats = await database.collection('posts').aggregate([
                { $match: { "verifications.0": { $exists: true } } }, 
                { $group: { _id: "$userId", username: { $first: "$username" }, count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]).toArray();

            // pulls from users collection
            const distanceStats = await database.collection('users').find({})
                .project({ username: 1, totalDistance: 1, userId: 1 })
                .sort({ totalDistance: -1 })
                .limit(10)
                .toArray();

            res.json({ completions: completionStats, distance: distanceStats });
        });

        // delete comment
        app.delete('/api/posts/:postId/comments/:commentId', async (req, res) => {
            await database.collection('posts').updateOne(
                { _id: new ObjectId(req.params.postId) },
                { $pull: { comments: { id: req.params.commentId } } }
            );
            const updated = await database.collection('posts').findOne({ _id: new ObjectId(req.params.postId) });
            res.json(updated);
        });

        app.delete('/api/posts/:postId/comments/:commentId/replies/:idx', async (req, res) => {
            const { postId, commentId, idx } = req.params;
            const post = await database.collection('posts').findOne({ _id: new ObjectId(postId) });
            
            const comment = post.comments.find(c => c.id === commentId);
            if (comment) {
                comment.replies.splice(parseInt(idx), 1);
                await database.collection('posts').updateOne(
                    { _id: new ObjectId(postId) },
                    { $set: { comments: post.comments } }
                );
            }
            res.json(await database.collection('posts').findOne({ _id: new ObjectId(postId) }));
        });

        // add reply to comment
        app.post('/api/posts/:postId/comments/:commentId/replies', async (req, res) => {
            const { username, text } = req.body;
            const reply = { username, text, date: new Date() };

            await database.collection('posts').updateOne(
                { _id: new ObjectId(req.params.postId), "comments.id": req.params.commentId },
                { $push: { "comments.$.replies": reply } }
            );
            const updated = await database.collection('posts').findOne({ _id: new ObjectId(req.params.postId) });
            res.json(updated);
        });

        // user data in DB on login
        app.post('/api/users/sync', async (req, res) => {
            const { userId, username } = req.body;
            const users = client.db('waypoint').collection('users');
            
            // ensure username is updated if it's currently missing or null
            await users.updateOne(
                { userId: userId },
                { 
                $set: { username: username }, 
                $setOnInsert: { totalDistance: 0 } 
                },
                { upsert: true }
            );
            const profile = await users.findOne({ userId: userId });
            res.json(profile);
        });

        app.patch('/api/posts/:id/like', async (req, res) => {
            try {
                const { userId } = req.body;
                const postId = req.params.id;
                const post = await posts.findOne({ _id: new ObjectId(postId) });
                if (!post) return res.status(404).send("Post not found");

                const isLiked = post.likes?.includes(userId);
                const update = isLiked 
                    ? { $pull: { likes: userId } } 
                    : { $addToSet: { likes: userId } };

                await posts.updateOne({ _id: new ObjectId(postId) }, update);
                const updatedPost = await posts.findOne({ _id: new ObjectId(postId) });
                res.json(updatedPost);
            } catch (err) {
                console.error(err);
                res.status(500).send("Server Error");
            }
        });

        app.patch('/api/posts/:id/verify', async (req, res) => {
            const { userId } = req.body;
            const postId = req.params.id;

            const post = await posts.findOne({ _id: new ObjectId(postId) });
            const hasFlagged = post.verifications?.includes(userId);

            const update = hasFlagged 
                ? { $pull: { verifications: userId } } 
                : { $addToSet: { verifications: userId } };

            await posts.updateOne({ _id: new ObjectId(postId) }, update);
            const updatedPost = await posts.findOne({ _id: new ObjectId(postId) });
            res.json(updatedPost);
        });

        // update user distance
        app.patch('/api/user/distance', async (req, res) => {
            const { userId, distanceInKm } = req.body;
            const users = client.db('waypoint').collection('users');

            // check last update time
            const user = await users.findOne({ userId: userId });
            const now = Date.now();
    
            // ignore updates faster than every 2 seconds
            if (user.lastDistanceUpdate && (now - user.lastDistanceUpdate < 2000)) {
                return res.json(user); // existing data without updating
            }

            const updatedUser = await users.findOneAndUpdate(
                { userId: userId },
                { $inc: { totalDistance: distanceInKm } },
                { returnDocument: 'after' }
            );
            res.json(updatedUser);
        });

        app.use(express.static(path.join(__dirname, '../client/build')));

        app.get('*index', (req, res) => {
            res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
        });

        app.listen(PORT, () => console.log(`Server on port ${PORT}`));
    } catch (err) { console.error(err); }
}
run();