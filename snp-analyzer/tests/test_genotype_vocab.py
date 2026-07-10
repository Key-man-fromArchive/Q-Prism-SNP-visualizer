"""Phase 0 — genotype vocabulary registry + ploidy plumbing.

Locks in two contracts:
  1. Diploid output is byte-identical to the pre-Phase-0 behavior (no regression).
  2. The registry generalizes correctly to higher ploidy (dosage 0..P labels/cuts).
"""
import os
import tempfile
import unittest
from pathlib import Path

from app.processing import genotype_vocab as gv
from app.processing.genotype import count_genotypes


class GenotypeVocabTest(unittest.TestCase):
    def test_diploid_labels_preserved_verbatim(self):
        # dosage 0,1,2 -> historical WellType strings (must never change)
        self.assertEqual(
            gv.genotype_labels(2),
            ["Allele 2 Homo", "Heterozygous", "Allele 1 Homo"],
        )
        self.assertEqual(gv.genotype_label(2, 2), "Allele 1 Homo")
        self.assertEqual(gv.genotype_label(1, 2), "Heterozygous")
        self.assertEqual(gv.genotype_label(0, 2), "Allele 2 Homo")

    def test_tetraploid_labels_allele_count_strings(self):
        self.assertEqual(
            gv.genotype_labels(4),
            ["BBBB", "ABBB", "AABB", "AAAB", "AAAA"],
        )
        self.assertEqual(gv.genotype_label(3, 4), "AAAB")
        self.assertEqual(gv.dosage_of_label("AABB", 4), 2)
        self.assertIsNone(gv.dosage_of_label("NTC", 4))

    def test_label_count_matches_ploidy_plus_one(self):
        for p in range(gv.MIN_PLOIDY, gv.MAX_PLOIDY + 1):
            self.assertEqual(len(gv.genotype_labels(p)), p + 1)

    def test_validate_ploidy_bounds(self):
        for bad in (1, 9, 0, -2, 2.0, "4"):
            with self.assertRaises(ValueError):
                gv.validate_ploidy(bad)  # type: ignore[arg-type]
        for good in range(2, 9):
            self.assertEqual(gv.validate_ploidy(good), good)

    def test_default_cuts_are_equal_spaced_midpoints_descending(self):
        self.assertEqual(gv.default_ratio_cuts(2), [0.75, 0.25])
        self.assertEqual(gv.default_ratio_cuts(4), [0.875, 0.625, 0.375, 0.125])
        cuts = gv.default_ratio_cuts(4)
        self.assertEqual(cuts, sorted(cuts, reverse=True))

    def test_dosage_by_ratio_tetraploid(self):
        # A well right on an ideal dosage ratio d/P lands in that dosage.
        for d in range(5):
            r = d / 4
            self.assertEqual(gv.dosage_by_ratio(r, 4), d, msg=f"r={r}")
        self.assertEqual(gv.label_by_ratio(1.0, 4), "AAAA")
        self.assertEqual(gv.label_by_ratio(0.0, 4), "BBBB")

    def test_count_genotypes_diploid_identical_contract(self):
        eff = {
            "A1": "Allele 1 Homo",
            "A2": "Heterozygous",
            "A3": "Allele 2 Homo",
            "A4": "NTC",
            "A5": "Undetermined",
            "A6": "Allele 1 Homo",
        }
        # Default (no ploidy arg) must produce the exact historical dict.
        self.assertEqual(
            count_genotypes(eff),
            {"AA": 2, "AB": 1, "BB": 1, "excluded": 2},
        )
        self.assertEqual(count_genotypes(eff), count_genotypes(eff, ploidy=2))

    def test_count_genotypes_tetraploid_dosage_keyed(self):
        eff = {
            "A1": "AAAA",
            "A2": "AABB",
            "A3": "AABB",
            "A4": "BBBB",
            "A5": "NTC",
            "A6": "Undetermined",
        }
        counts = count_genotypes(eff, ploidy=4)
        self.assertEqual(counts["AAAA"], 1)
        self.assertEqual(counts["AABB"], 2)
        self.assertEqual(counts["BBBB"], 1)
        self.assertEqual(counts["AAAB"], 0)
        self.assertEqual(counts["ABBB"], 0)
        self.assertEqual(counts["excluded"], 2)


class PloidyPersistenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        import app.db as db

        if db._conn is not None:
            db._conn.close()
        db._conn = None
        db.DB_PATH = Path(self.tmp.name) / "test.sqlite3"

    def tearDown(self):
        import app.db as db

        if db._conn is not None:
            db._conn.close()
        db._conn = None
        self.tmp.cleanup()

    def _load(self, sid):
        from app.db import load_all_sessions

        for entry in load_all_sessions():
            if entry["session_id"] == sid:
                return entry["unified"]
        raise AssertionError(f"session {sid} not found")

    def _unified(self, ploidy=2):
        from app.models import UnifiedData, WellCycleData

        return UnifiedData(
            instrument="Test",
            allele2_dye="HEX",
            wells=["A1", "A2"],
            cycles=[1],
            data=[
                WellCycleData(well="A1", cycle=1, fam=1.0, allele2=0.2, rox=1.0),
                WellCycleData(well="A2", cycle=1, fam=0.2, allele2=1.0, rox=1.0),
            ],
            has_rox=True,
            sample_names={"A1": "S1", "A2": "S2"},
            ploidy=ploidy,
        )

    def test_default_ploidy_is_two(self):
        from app.db import init_db, save_session

        init_db()
        save_session("sid-d", self._unified())
        self.assertEqual(self._load("sid-d").ploidy, 2)

    def test_ploidy_survives_save_and_load(self):
        from app.db import init_db, save_session

        init_db()
        save_session("sid-4", self._unified(ploidy=4))
        self.assertEqual(self._load("sid-4").ploidy, 4)

    def test_set_session_ploidy_merges_without_dropping_metadata(self):
        from app.db import init_db, save_session, set_session_ploidy

        init_db()
        save_session("sid-m", self._unified(ploidy=2))
        set_session_ploidy("sid-m", 6)
        loaded = self._load("sid-m")
        self.assertEqual(loaded.ploidy, 6)
        # A pre-existing metadata field must not be clobbered by the merge.
        self.assertEqual(loaded.sample_names, {"A1": "S1", "A2": "S2"})


if __name__ == "__main__":
    unittest.main()
