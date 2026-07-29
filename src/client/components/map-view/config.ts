import type { StyleSpecification } from 'maplibre-gl';

import { MML_API_KEY } from '@common/features';

function mmlTile(layer: string, ext: string) {
  return `https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/${layer}/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.${ext}?api-key=${MML_API_KEY}`;
}

function styles(): Record<string, StyleSpecification> {
  return {
    satellite: {
      version: 8,
      sources: {
        'google-satellite': {
          type: 'raster',
          tiles: [
            'https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
            'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
            'https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
            'https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
          ],
          tileSize: 256,
          maxzoom: 20,
          attribution: '© Google'
        }
      },
      layers: [
        { id: 'google-satellite', type: 'raster', source: 'google-satellite' }
      ]
    },
    topo: {
      version: 8,
      sources: {
        'google-terrain': {
          type: 'raster',
          tiles: [
            'https://mt0.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
            'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
            'https://mt2.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
            'https://mt3.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'
          ],
          tileSize: 256,
          maxzoom: 20,
          attribution: '© Google'
        }
      },
      layers: [
        { id: 'google-terrain', type: 'raster', source: 'google-terrain' }
      ]
    },
    mml_maastokartta: {
      version: 8,
      sources: {
        mml_maastokartta: {
          type: 'raster',
          tiles: [mmlTile('maastokartta', 'png')],
          tileSize: 256,
          maxzoom: 16,
          bounds: [19.0, 59.5, 31.6, 70.1],
          attribution: '© Maanmittauslaitos'
        }
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#ffffff' }
        },
        {
          id: 'mml_maastokartta',
          type: 'raster',
          source: 'mml_maastokartta'
        }
      ]
    },
    mml_ortokuva: {
      version: 8,
      sources: {
        mml_ortokuva: {
          type: 'raster',
          tiles: [mmlTile('ortokuva', 'jpg')],
          tileSize: 256,
          maxzoom: 16,
          bounds: [19.0, 59.5, 31.6, 70.1],
          attribution: '© Maanmittauslaitos'
        }
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#ffffff' }
        },
        { id: 'mml_ortokuva', type: 'raster', source: 'mml_ortokuva' }
      ]
    }
  };
}

export default { styles };
