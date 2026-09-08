import copy
import pathlib
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
from sync import fetch_repositories, pages_url, synchronize
from build import render


def repository(name, identity, **changes):
    return {"name": name, "id": identity, "owner": {"login": "brianann2339"},
            "full_name": f"brianann2339/{name}", "html_url": f"https://github.com/brianann2339/{name}",
            "description": "測試用來源說明", "private": False, "has_pages": True, **changes}


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.data = {"owner": "brianann2339", "checkedAt": "2026-09-05T00:00:00+00:00", "sites": [{
            "repo": "NeuGlia", "repositoryId": 1, "category": "medical", "title": "NeuGlia",
            "description": "已整理的說明", "url": "https://brianann2339.github.io/NeuGlia/neuglia/",
            "repository": "https://github.com/brianann2339/NeuGlia", "status": 200,
            "sourceTitle": "Education Meeting HTML5 Template", "sourceDescription": None,
        }]}
        self.inspect = lambda url: (200, "來源網頁標題", "來源網頁說明")

    def test_addition_excludes_private_disabled_and_directory(self):
        repos = [repository("NeuGlia", 1), repository("new-site", 2), repository("private-site", 3, private=True),
                 repository("disabled-site", 4, has_pages=False), repository("all", 5)]
        result = synchronize(self.data, repos, self.inspect)
        self.assertEqual([site["repo"] for site in result["sites"]], ["NeuGlia", "new-site"])
        self.assertEqual(result["sites"][1]["category"], "other")
        self.assertEqual(result["sites"][1]["title"], "來源網頁標題")
        self.assertFalse(result["sites"][1]["curated"])

    def test_special_entry_and_curated_copy_survive_rename(self):
        result = synchronize(self.data, [repository("renamed-site", 1)], self.inspect)["sites"][0]
        self.assertEqual(result["url"], "https://brianann2339.github.io/renamed-site/neuglia/")
        self.assertEqual(result["title"], "NeuGlia")
        self.assertEqual(result["description"], "已整理的說明")
        self.assertEqual(result["category"], "medical")

    def test_removed_or_private_repository_disappears(self):
        result = synchronize(self.data, [repository("NeuGlia", 1, private=True), repository("new-site", 2)], self.inspect)
        self.assertEqual([site["repo"] for site in result["sites"]], ["new-site"])

    def test_reused_name_does_not_inherit_another_repository(self):
        result = synchronize(self.data, [repository("NeuGlia", 2)], self.inspect)["sites"][0]
        self.assertEqual(result["url"], "https://brianann2339.github.io/NeuGlia/")
        self.assertEqual(result["category"], "other")
        self.assertFalse(result["curated"])

    def test_bad_link_is_visible_and_not_dropped(self):
        result = synchronize(self.data, [repository("NeuGlia", 1)], lambda url: (404, "", ""))
        self.assertEqual(len(result["sites"]), 1)
        self.assertIn("連結待確認", render(result))

    def test_manual_external_site_survives_and_refreshes_status(self):
        manual = {
            "repo": "external.pages.dev", "sync": "manual", "curated": True, "category": "medical",
            "title": "外部教學平台", "description": "需要登入。", "url": "https://external.pages.dev/",
            "repository": None, "status": 200, "accessRequired": True, "sourceTitle": "登入", "sourceDescription": None,
        }
        self.data["sites"].append(manual)
        result = synchronize(self.data, [repository("NeuGlia", 1)], lambda url: (403 if "external" in url else 200, "登入", ""))
        external = result["sites"][-1]
        self.assertEqual(external["repo"], "external.pages.dev")
        self.assertEqual(external["status"], 403)
        output = render(result)
        before, after = output.split("外部教學平台", 1)
        card = before.rsplit("<article", 1)[1] + after.split("</article>", 1)[0]
        self.assertIn("需登入", card)
        self.assertNotIn("GitHub 原始碼", card)

    def test_empty_result_preserves_input(self):
        before = copy.deepcopy(self.data)
        with self.assertRaisesRegex(ValueError, "previous directory was preserved"):
            synchronize(self.data, [], self.inspect)
        self.assertEqual(self.data, before)

    def test_remote_html_is_escaped(self):
        result = synchronize(self.data, [repository("new-site", 2)], lambda url: (200, '中文<script>alert("test")</script>', ""))
        output = render(result)
        self.assertNotIn("<script>", output)
        self.assertIn("中文&lt;script&gt;", output)

    def test_user_site_has_no_repository_suffix(self):
        self.assertEqual(pages_url("brianann2339", "brianann2339.github.io"), "https://brianann2339.github.io/")

    def test_repository_list_pagination(self):
        class Response:
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return self.body
        import json
        first = [repository(f"fixture-{index}", index) for index in range(100)]
        second = [repository("last-fixture", 100)]
        with patch("sync.urlopen", side_effect=[Response(json.dumps(first)), Response(json.dumps(second))]) as request:
            result = fetch_repositories("brianann2339")
        self.assertEqual(len(result), 101)
        self.assertIn("page=2", request.call_args[0][0].full_url)


if __name__ == "__main__":
    unittest.main()
