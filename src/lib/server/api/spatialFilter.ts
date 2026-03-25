import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { Bounds } from "@/lib/mapObjects/mapBounds";

export function buildSpatialFilter(
	polygon: Feature<Polygon | MultiPolygon> | null,
	bounds: Bounds,
	pointExpr = "Point(lon, lat)"
): { sql: string; values: any[] } {
	if (polygon) {
		return {
			sql: `ST_Contains(ST_GeomFromGeoJSON(?), ${pointExpr})`,
			values: [JSON.stringify(polygon.geometry)]
		};
	}
	return {
		sql: "lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
		values: [bounds.minLat, bounds.maxLat, bounds.minLon, bounds.maxLon]
	};
}
