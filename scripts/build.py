import html
import json
import pathlib
import shutil
from datetime import datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parents[1]
GROUPS = [
    ("personal", "個人與品牌", "個人網站、專業服務與重要時刻。"),
    ("medical", "醫療與研究", "急診資訊、資料說明與互動模型。"),
    ("life", "生活與旅行", "找航班、找餐廳，也找下一個住處。"),
    ("other", "其他網頁", "其他已發布的網站。"),
]


def escape(value):
    return html.escape(str(value), quote=True)


def safe_url(value):
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username:
        raise ValueError(f"Invalid public URL: {value}")
    return escape(value)


def render(data):
    sites = data["sites"]
    if not sites or len({site["repo"] for site in sites}) != len(sites):
        raise ValueError("Site list must be nonempty and contain no duplicate repositories")
    if any(site["category"] not in {group[0] for group in GROUPS} for site in sites):
        raise ValueError("Unknown category")
    checked = datetime.fromisoformat(data["checkedAt"]).astimezone(ZoneInfo("Asia/Tokyo")).strftime("%Y.%m.%d %H:%M JST")
    nav, sections = [], []
    count = 0
    for group_id, name, description in GROUPS:
        group = [site for site in sites if site["category"] == group_id]
        if not group:
            continue
        nav.append(f'<a href="#{group_id}">{name}<span>{len(group):02}</span></a>')
        cards = []
        for site in group:
            count += 1
            title = escape(site["title"] or site["repo"])
            status = site["status"]
            protected = site.get("accessRequired") and status in (200, 401, 403)
            available = protected or isinstance(status, int) and 200 <= status < 400
            if not available:
                badge = '<span class="warning">連結待確認</span>'
                label = "嘗試開啟"
            elif protected:
                badge = '<span class="warning">需登入</span>'
                label = "前往登入"
            else:
                badge = ""
                label = "開啟網站"
            source_link = ""
            if site.get("repository"):
                source_link = f'<a class="source-link" href="{safe_url(site["repository"])}" target="_blank" rel="noopener noreferrer" aria-label="{title} 的 GitHub 原始碼（另開分頁）">GitHub 原始碼 ↗</a>'
            cards.append(f'''<article class="site-card">
              <div class="card-top"><span class="number">{count:02}</span>{badge}<span class="card-mark" aria-hidden="true">↗</span></div>
              <h3><a class="site-link" href="{safe_url(site['url'])}" target="_blank" rel="noopener noreferrer">{title}<span class="sr-only">（另開分頁）</span></a></h3>
              <p class="description">{escape(site['description'])}</p>
              <div class="card-bottom"><span class="repo-name">{escape(site['repo'])}</span><span class="open-label" aria-hidden="true">{label} ↗</span></div>
              {source_link}
            </article>''')
        sections.append(f'''<section class="collection" id="{group_id}" aria-labelledby="{group_id}-heading">
          <div class="section-heading"><div><h2 id="{group_id}-heading">{name}<span>{len(group):02}</span></h2><p>{description}</p></div></div>
          <div class="cards">{''.join(cards)}</div>
        </section>''')
    template = (ROOT / "src/index.html").read_text()
    for key, value in {"NAV": "".join(nav), "SECTIONS": "".join(sections), "TOTAL": str(len(sites)), "CHECKED": checked}.items():
        template = template.replace("{{" + key + "}}", value)
    return template


def main():
    data = json.loads((ROOT / "sites.json").read_text())
    output = render(data)
    destination = ROOT / "dist"
    destination.mkdir(exist_ok=True)
    (destination / "index.html").write_text(output)
    shutil.copyfile(ROOT / "src/styles.css", destination / "styles.css")
    shutil.copyfile(ROOT / "src/favicon.svg", destination / "favicon.svg")
    (destination / ".nojekyll").touch()
    print(f"Built {len(data['sites'])} sites into dist/index.html")


if __name__ == "__main__":
    main()
