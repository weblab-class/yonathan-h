import * as turf from '@turf/turf';

// hole in unrevealed world for user
export const getFogGeoJSON = (center, radiusKm = 0.3) => {
  const world = turf.polygon([[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]]);
  const hole = turf.circle(center, radiusKm, { units: 'kilometers' });
  
  // combines darkness and hole into single shape
  return turf.difference(turf.featureCollection([world, hole]));
};