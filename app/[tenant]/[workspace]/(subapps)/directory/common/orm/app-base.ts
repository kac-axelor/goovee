import type {Client} from '@/goovee/.generated/client';

import {MAP_SELECT} from '../constants';
import type {MapConfig} from '../types';

export async function findMapConfig({
  client,
}: {
  client: Client;
}): Promise<MapConfig> {
  const mapConfig = await client.aOSAppBase.findOne({
    where: {OR: [{archived: false}, {archived: null}]},
    select: {
      mapApiSelect: true,
      googleMapsApiKey: true,
    },
  });

  if (mapConfig?.mapApiSelect === MAP_SELECT.GoogleMaps) {
    return {map: MAP_SELECT.GoogleMaps, apiKey: mapConfig.googleMapsApiKey};
  }

  return {map: MAP_SELECT.OpenStreetMap};
}
