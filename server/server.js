require('dotenv').config({ path: '../client/.env' });
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors({ origin: 'https://waypointsite.onrender.com' }));
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

        app.get('/api/quests', async (req, res) => {
            const all = await quests.find({}).toArray();
            res.json(all);
        });

        app.post('/api/quests', async (req, res) => {
            const result = await quests.insertOne(req.body);
            res.status(201).json(result);
        });

        app.get('/api/posts', async (req, res) => {
            const all = await posts.find({}).sort({ _id: -1 }).toArray();
            res.json(all);
        });

        app.post('/api/posts', async (req, res) => {
            const result = await posts.insertOne(req.body);
            res.status(201).json({ ...req.body, _id: result.insertedId });
        });

        app.listen(PORT, () => console.log(`Server on port ${PORT}`));
    } catch (err) { console.error(err); }
}
run();