import json
import os
import pathlib
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = pathlib.Path(__file__).resolve().parents[1]


class PageMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_title = False
        self.title = ""
        self.description = ""

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag == "meta":
            attrs = dict(attrs)
            if attrs.get("name", "").lower() == "description":
                self.description = attrs.get("content", "")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, value):
        if self.in_title:
            self.title += value


def fetch_repositories(owner):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "pages-directory-sync"}
    if os.environ.get("GH_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GH_TOKEN']}"
    repositories = []
    page = 1
    while True:
        url = f"https://api.github.com/users/{quote(owner, safe='')}/repos?per_page=100&page={page}&type=owner"
        with urlopen(Request(url, headers=headers), timeout=30) as response:
            batch = json.load(response)
        if not isinstance(batch, list):
            raise ValueError("GitHub did not return a repository list")
        repositories.extend(batch)
        if len(batch) < 100:
            return repositories
        page += 1


def pages_url(owner, name):
    base = f"https://{owner.lower()}.github.io/"
    return base if name.lower() == f"{owner.lower()}.github.io" else base + quote(name, safe="") + "/"


def inspect_page(url):
    request = Request(url, headers={"User-Agent": "pages-directory-sync"})
    try:
        with urlopen(request, timeout=25) as response:
            text = response.read(262144).decode(response.headers.get_content_charset() or "utf-8", errors="replace")
            parser = PageMetadata()
            parser.feed(text)
            return response.status, " ".join(parser.title.split()), " ".join(parser.description.split())
    except HTTPError as error:
        return error.code, "", ""
    except (URLError, TimeoutError):
        return "unreachable", "", ""


def synchronize(data, repositories, inspect=inspect_page):
    owner = data["owner"]
    directory = os.environ.get("GITHUB_REPOSITORY", f"{owner}/all").lower()
    previous_by_name = {site["repo"]: site for site in data["sites"]}
    previous_by_id = {site["repositoryId"]: site for site in data["sites"] if "repositoryId" in site}
    order = {site["repo"]: index for index, site in enumerate(data["sites"])}
    current = [repo for repo in repositories if repo["owner"]["login"].lower() == owner.lower()
               and repo.get("has_pages") is True and repo.get("private") is False
               and repo["full_name"].lower() != directory]
    if not current:
        raise ValueError("GitHub returned no public Pages sites; previous directory was preserved")
    entries = []
    for repo in current:
        previous = previous_by_id.get(repo["id"], {})
        if not previous:
            same_name = previous_by_name.get(repo["name"], {})
            if "repositoryId" not in same_name:
                previous = same_name
        url = pages_url(owner, repo["name"])
        if previous:
            old_base = pages_url(owner, previous["repo"])
            url = url + previous["url"][len(old_base):] if previous["url"].startswith(old_base) else previous["url"]
        status, title, description = inspect(url)
        curated = previous.get("curated", bool(previous))
        source_title = title or previous.get("sourceTitle", "")
        entries.append({
            "repo": repo["name"],
            "repositoryId": repo["id"],
            "curated": curated,
            "category": previous.get("category", "other"),
            "title": previous["title"] if curated else source_title or repo["name"],
            "description": previous["description"] if curated else repo.get("description") or description or "GitHub Pages 網站。",
            "url": url,
            "repository": repo["html_url"],
            "status": status,
            "sourceTitle": source_title,
            "sourceDescription": repo.get("description"),
        })
        if status != 200:
            print(f"Link needs attention: {repo['name']} ({status})")
    entries.sort(key=lambda site: (order.get(previous_by_id.get(site["repositoryId"], {}).get("repo", site["repo"]), len(order)), site["repo"].lower()))
    return {"owner": owner, "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sites": entries}


def main():
    path = ROOT / "sites.json"
    data = json.loads(path.read_text())
    updated = synchronize(data, fetch_repositories(data["owner"]))
    from build import render
    render(updated)
    path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n")
    print(f"Synced {len(updated['sites'])} public GitHub Pages sites")


if __name__ == "__main__":
    main()
