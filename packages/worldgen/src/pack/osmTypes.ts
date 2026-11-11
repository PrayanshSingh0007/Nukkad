/** The parts of an Overpass API (OpenStreetMap) JSON answer that we read. */

export type OsmTags = Record<string, string>;

export interface OsmLatLon {
  lat: number;
  lon: number;
}

export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: OsmTags;
}

export interface OsmWay {
  type: 'way';
  id: number;
  /** Present because we ask Overpass for `out geom`. Entries can be null for broken data. */
  geometry?: (OsmLatLon | null)[];
  tags?: OsmTags;
}

export interface OsmMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
  geometry?: (OsmLatLon | null)[];
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  members?: OsmMember[];
  tags?: OsmTags;
}

export type OsmElement = OsmNode | OsmWay | OsmRelation;

export interface OverpassResponse {
  elements: OsmElement[];
}
