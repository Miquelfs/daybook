import unittest

from domains.health.garmin.polyline_backfill import coords_from_detail, encode


class PolylineTest(unittest.TestCase):
    def test_google_reference_encoding(self):
        self.assertEqual(encode([(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]), "_p~iF~ps|U_ulLnnqC_mqNvxq`@")

    def test_coords_from_garmin_detail_payload(self):
        raw = {"geoPolylineDTO": {"polyline": [{"lat": 39.5, "lon": 2.6}, {"lat": 39.6, "lon": 2.7}, {"lat": 0, "lon": 0}]}}
        self.assertEqual(coords_from_detail(raw), [(39.5, 2.6), (39.6, 2.7)])

    def test_coords_from_metric_columns(self):
        raw = {"metricDescriptors": [{"key": "directLatitude", "metricsIndex": 0},
                                     {"key": "directLongitude", "metricsIndex": 1}],
               "activityDetailMetrics": [{"metrics": [39.5, 2.6]}, {"metrics": [39.6, 2.7]}]}
        self.assertEqual(coords_from_detail(raw), [(39.5, 2.6), (39.6, 2.7)])


if __name__ == "__main__":
    unittest.main()
