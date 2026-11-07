"""Build the static reader and EPUB/TXT from the twenty Markdown chapters."""
from pathlib import Path
from datetime import datetime, timezone
from html import escape as e
from xml.etree import ElementTree as ET
import hashlib
import json
import math
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
BASE = 'https://veylcode.github.io/velt-price-of-greatness/'
DOWNLOADS = SITE / 'downloads'
DOWNLOADS.mkdir(exist_ok=True)


def chapters():
    result = []
    for path in sorted((ROOT / 'manuscript').glob('[0-9][0-9].md')):
        lines = path.read_text(encoding='utf-8').strip().splitlines()
        match = re.fullmatch(r'# Глава (\d+)\. (.+)', lines[0])
        if not match or not lines[2].strip():
            raise ValueError(f'Invalid chapter heading: {path.name}')
        number, title = int(match[1]), match[2]
        paragraphs = [p.strip().replace('\n', ' ') for p in '\n'.join(lines[4:]).split('\n\n') if p.strip()]
        if not paragraphs or any(p.startswith('#') for p in paragraphs):
            raise ValueError(f'Invalid chapter body: {path.name}')
        words = len(re.findall(r'\b\w+(?:[-’\x27]\w+)*\b', ' '.join(paragraphs)))
        result.append(dict(n=number, title=title, date=lines[2], paragraphs=paragraphs, words=words,
                           minutes=max(1, math.ceil(words/190)), id=f'chapter-{number}'))
    if [c['n'] for c in result] != list(range(1, 21)):
        raise ValueError('Part I must contain chapters 1–20 exactly')
    return result


CHAPTERS = chapters()
TOTAL = sum(c['words'] for c in CHAPTERS)
VERSION = hashlib.sha256(''.join((SITE / f).read_text(encoding='utf-8') for f in ('style.css','reader.js','boot.js')).encode()).hexdigest()[:10]
ICONS = {
    'menu':'<path d="M4 6h16M4 12h11M4 18h16"/>',
    'moon':'<path d="M20 15.5A8.7 8.7 0 0 1 8.5 4 8.7 8.7 0 1 0 20 15.5Z"/>',
    'arrow':'<path d="M4 12h16M13 5l7 7-7 7"/>',
    'bookmark':'<path d="M6 4h12v17l-6-4-6 4Z"/>',
    'focus':'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
}


def icon(name):
    return f'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICONS[name]}</svg>'


def chapter_list(current='', dialog=False):
    links = []
    for c in CHAPTERS:
        active = ' aria-current="page"' if current == c['id'] else ''
        links.append(f'<li><a class="chapter-link" data-page="{c["id"]}" data-number="{c["n"]}" href="{c["id"]}.html"{active}>'
                     f'<span class="chapter-number">{c["n"]}</span><span class="chapter-name">{e(c["title"])}</span>'
                     f'<span class="chapter-time">{c["minutes"]} мин</span></a></li>')
    return f'<ol class="{"dialog-chapters" if dialog else "chapter-grid"}"{ " id=\"toc-list\"" if dialog else ""}>' + ''.join(links) + '</ol>'


def dialogs(current):
    themes = [('auto','Как в системе'),('paper','Бумага'),('light','Светлая'),('night','Ночная')]
    choices = ''.join(f'<button class="choice" data-setting="theme" data-value="{value}" aria-pressed="{str(value=="auto").lower()}">{name}</button>' for value,name in themes)
    return f'''<dialog id="contents" aria-labelledby="contents-title"><div class="dialog-head"><h2 id="contents-title">Оглавление</h2><button class="close" data-close aria-label="Закрыть оглавление">×</button></div>
<section class="bookmarks" id="bookmark-section" hidden><h3>Ваши закладки</h3><div id="bookmark-list"></div></section>
<label class="search-label" for="chapter-filter">Найти главу по названию или номеру</label><input id="chapter-filter" type="search" autocomplete="off" maxlength="120">
<span class="empty" id="toc-count" role="status"></span><p class="empty" id="toc-empty" hidden>Такой главы нет. Попробуйте другое название или номер.</p>{chapter_list(current,True)}
</dialog>
<dialog id="appearance" aria-labelledby="appearance-title"><div class="dialog-head"><h2 id="appearance-title">Ваше чтение</h2><button class="close" data-close aria-label="Закрыть настройки">×</button></div>
<fieldset><legend>Стиль издания</legend><div class="choices"><button class="choice style-choice book" data-setting="style" data-value="book" aria-pressed="true"><b>Книжный</b><span>Засечки и абзацные отступы</span></button><button class="choice style-choice" data-setting="style" data-value="clear" aria-pressed="false"><b>Лаконичный</b><span>Прямой шрифт и больше воздуха</span></button></div></fieldset>
<fieldset><legend>Цвет страницы</legend><div class="choices">{choices}</div></fieldset>
<div class="range-row"><span class="size-label">Размер текста</span><div class="size-control"><button id="size-less" aria-label="Уменьшить размер текста">А−</button><output id="size-value" aria-live="polite">21</output><button id="size-more" aria-label="Увеличить размер текста">А+</button></div></div>
<div class="range-row"><label for="line-height">Между строками</label><select id="line-height"><option value="1.6">Плотнее</option><option value="1.8" selected>Обычно</option><option value="2">Свободнее</option></select></div>
<div class="range-row"><label for="line-width">Ширина строки</label><select id="line-width"><option value="54">Узкая</option><option value="65" selected>Книжная</option><option value="74">Широкая</option></select></div>
<p class="dialog-note">Оформление, закладки и место чтения сохраняются в этом браузере. На другом устройстве можно начать с нужной главы.</p></dialog>
<div id="notice" role="status" aria-live="polite" hidden></div>'''


def shell(title, body, current='', description=None):
    desc = description or 'VELT: Цена величия. Первая часть «Начало», 20 глав. Роман о людях, которые строят своё дело и учатся защищать его.'
    page = current+'.html' if current else 'index.html'
    focus = f'<button class="tool" id="focus-toggle" aria-label="Читать без панелей">{icon("focus")}<span class="tool-label">Без панелей</span></button>' if current else ''
    return f'''<!doctype html>
<html lang="ru" data-style="book"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f6f3eb"><title>{e(title)} · VELT</title><meta name="description" content="{e(desc,quote=True)}">
<link rel="canonical" href="{BASE}{page}"><link rel="icon" href="favicon.svg" type="image/svg+xml"><script src="boot.js?v={VERSION}"></script><link rel="stylesheet" href="style.css?v={VERSION}"><script src="reader.js?v={VERSION}" defer></script></head>
<body class="{'reading' if current else 'home'}" data-page="{current}"><a class="skip" href="#main">К тексту</a>
<header class="masthead"><a class="brand" href="index.html" aria-label="VELT Цена величия — главная"><b>VELT</b><span>Цена величия</span></a><nav class="tools" aria-label="Настройки чтения">
{focus}<button class="tool" id="night-toggle" aria-label="Включить ночную тему" aria-pressed="false">{icon('moon')}<span class="tool-label">Ночь</span></button>
<button class="tool" data-open="contents" aria-haspopup="dialog" aria-label="Открыть оглавление">{icon('menu')}<span class="tool-label">Главы</span></button>
<button class="tool" data-open="appearance" aria-haspopup="dialog" aria-label="Настроить оформление"><span aria-hidden="true">Аа</span><span class="tool-label">Оформление</span></button></nav>
<div class="progress-track" aria-hidden="true"><div id="progress"></div></div></header>{body}
<div class="reader-footer"><footer class="footer"><a href="index.html">VELT · Цена величия</a><span>Часть I · Начало · 2007–2017</span><a href="downloads/VELT-Part-I.epub" download>Скачать EPUB</a></footer></div>
{dialogs(current)}{ '<button class="focus-exit" id="focus-exit">Вернуть панели · Esc</button>' if current else ''}
</body></html>'''


def make_site():
    formatted = f'{TOTAL:,}'.replace(',', ' ')
    home = f'''<main id="main" class="shell"><section class="hero" aria-labelledby="book-title"><div>
<p class="eyebrow">Роман · Часть I «Начало»</p><h1 id="book-title">Цена<br><em>величия</em></h1>
<p class="lead">В 2007 году Илье нужна новая работа. Виктор предлагает ему место в VELT — маленькой компании, которой ещё предстоит научиться выполнять свои обещания.</p>
<div class="actions"><a class="button" id="resume" href="chapter-1.html"><span id="resume-label">Начать читать</span>{icon('arrow')}</a><a class="text-link" href="#chapters">Оглавление</a></div>
<p class="reading-note" id="resume-note">20 глав · {formatted} слов · около {math.ceil(TOTAL/190)} минут чтения</p></div>
<div><div class="cover-stage"><img class="cover" src="cover.svg" width="600" height="840" alt="VELT. Цена величия. Часть первая: Начало. 2007–2017."></div><p class="cover-caption">Первая часть · новая редакция</p></div></section>
<section class="section about" aria-labelledby="about-title"><h2 id="about-title">Сначала —<br>обычная жизнь</h2><div><p>У Ильи маленькая дочь, жена возвращается на работу, а сервис, где он чинил чужие приборы, закрывается. В VELT его ждут первые заказы, собственные ошибки и люди, которым постепенно хочется доверять.</p><p>За десять лет они построят общее дело. В нём будет место трудным разговорам, семейным ужинам и маленьким победам. А потом найдётся документ, который заставит посмотреть на знакомую работу иначе.</p></div></section>
<section class="section" id="chapters" aria-labelledby="chapters-title"><div class="section-head"><h2 id="chapters-title">Начало</h2><p>2007–2017 · все 20 глав первой части</p></div>{chapter_list()}</section>
<section class="section download-row" id="download" aria-labelledby="download-title"><div><h2 id="download-title">Взять книгу с собой</h2><p>EPUB для MiBook и других читалок. TXT — обычный текст без оформления. В файлах вся первая часть.</p></div><div class="download-links"><a href="downloads/VELT-Part-I.epub" download>EPUB</a><a href="downloads/VELT-Part-I.txt" download>TXT</a></div></section></main>'''
    (SITE/'index.html').write_text(shell('Цена величия — Начало',home),encoding='utf-8')
    for c in CHAPTERS:
        body = ''.join(f'<p id="p-{i}">{e(p)}</p>' for i,p in enumerate(c['paragraphs'],1))
        prev = CHAPTERS[c['n']-2] if c['n']>1 else None
        nxt = CHAPTERS[c['n']] if c['n']<20 else None
        before = f'<a href="{prev["id"]}.html" rel="prev"><small>Предыдущая глава</small><strong>{e(prev["title"])}</strong></a>' if prev else '<a href="index.html"><small>Вернуться</small><strong>О книге</strong></a>'
        after = f'<a class="next" href="{nxt["id"]}.html" rel="next"><small>Следующая глава</small><strong>{e(nxt["title"])}</strong></a>' if nxt else '<a class="next" href="index.html#chapters"><small>Все главы</small><strong>К оглавлению</strong></a>'
        ending = '<section class="part-end"><h2>Конец первой части</h2><p>«Начало» · 2007–2017</p><a class="text-link" href="downloads/VELT-Part-I.epub" download>Сохранить первую часть в EPUB</a></section>' if c['n']==20 else ''
        content = f'''<main id="main" class="reader"><header class="chapter-head"><div class="chapter-meta"><p class="eyebrow">Начало · Глава {c['n']} из 20</p><button class="tool" id="bookmark-toggle" aria-label="Поставить закладку" aria-pressed="false">{icon('bookmark')}<span class="tool-label" id="bookmark-label">Закладка</span></button></div>
<h1>{e(c['title'])}</h1><p class="date">{e(c['date'])} <span aria-hidden="true">·</span> {c['minutes']} мин чтения</p></header>
<article class="prose" aria-label="Текст главы {c['n']}">{body}</article>{ending}<nav class="chapter-navigation" aria-label="Переход между главами">{before}{after}</nav></main>'''
        (SITE/f'{c["id"]}.html').write_text(shell(f'Глава {c["n"]}. {c["title"]}',content,c['id']),encoding='utf-8')
    (SITE/'404.html').write_text(shell('Страница не найдена','<main id="main" class="shell"><section class="section"><p class="eyebrow">Страница не найдена</p><h1>Вернёмся к книге</h1><p>По этому адресу нет главы. В первой части двадцать глав, и все они собраны в оглавлении.</p><a class="button" href="index.html#chapters">Открыть оглавление</a></section></main>'),encoding='utf-8')
    (SITE/'.nojekyll').touch()
    urls = ['index.html']+[c['id']+'.html' for c in CHAPTERS]
    (SITE/'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+''.join(f'<url><loc>{BASE}{p}</loc></url>' for p in urls)+'</urlset>',encoding='utf-8')


def make_epub():
    text = 'VELT\nЦена величия\nЧасть I. Начало\n\n'+'\n\n'.join(f'Глава {c["n"]}. {c["title"]}\n{c["date"]}\n\n'+'\n\n'.join(c['paragraphs']) for c in CHAPTERS)+'\n\nКонец первой части\n'
    (DOWNLOADS/'VELT-Part-I.txt').write_text(text,encoding='utf-8')
    def xhtml(title,body):
        return f'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ru" lang="ru"><head><title>{e(title)}</title><link rel="stylesheet" type="text/css" href="book.css"/></head><body>{body}</body></html>'
    manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>','<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>','<item id="css" href="book.css" media-type="text/css"/>','<item id="cover" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>','<item id="title" href="title.xhtml" media-type="application/xhtml+xml" properties="svg"/>']
    manifest += [f'<item id="c{c["n"]}" href="{c["id"]}.xhtml" media-type="application/xhtml+xml"/>' for c in CHAPTERS]
    spine = '<itemref idref="title"/>' + ''.join(f'<itemref idref="c{c["n"]}"/>' for c in CHAPTERS)
    nav = '<nav epub:type="toc" id="toc"><h1>Содержание</h1><ol>'+''.join(f'<li><a href="{c["id"]}.xhtml">Глава {c["n"]}. {e(c["title"])}</a></li>' for c in CHAPTERS)+'</ol></nav>'
    ncx = '<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:velt:price-of-greatness:2026-11:part1"/></head><docTitle><text>VELT Цена величия</text></docTitle><navMap>'+''.join(f'<navPoint id="np{c["n"]}" playOrder="{c["n"]}"><navLabel><text>Глава {c["n"]}. {e(c["title"])}</text></navLabel><content src="{c["id"]}.xhtml"/></navPoint>' for c in CHAPTERS)+'</navMap></ncx>'
    opf = '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:velt:price-of-greatness:2026-11:part1</dc:identifier><dc:title>VELT: Цена величия. Часть I — Начало</dc:title><dc:language>ru</dc:language><dc:description>Первая часть романа, главы 1–20, 2007–2017.</dc:description><meta property="dcterms:modified">'+datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')+'</meta><meta name="cover" content="cover"/></metadata><manifest>'+''.join(manifest)+'</manifest><spine toc="toc">'+spine+'</spine></package>'
    with zipfile.ZipFile(DOWNLOADS/'VELT-Part-I.epub','w',compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('mimetype','application/epub+zip',compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr('OEBPS/package.opf',opf)
        z.writestr('OEBPS/nav.xhtml',xhtml('Содержание',nav))
        z.writestr('OEBPS/toc.ncx',ncx)
        z.writestr('OEBPS/book.css','body{font-family:serif;line-height:1.5;margin:5%;}h1,h2{font-weight:normal;text-align:center;line-height:1.2;}h1{margin-top:12%;}p{margin:.35em 0;text-indent:1.3em;}p:first-of-type{text-indent:0;}.date{text-align:center;text-indent:0;font-size:.9em;margin-bottom:2em;}img{max-width:100%;max-height:95vh;}li{margin:.7em 0;}')
        z.writestr('OEBPS/cover.svg',(SITE/'cover.svg').read_bytes())
        z.writestr('OEBPS/title.xhtml',xhtml('VELT Цена величия','<section epub:type="titlepage"><h1>VELT</h1><h2>Цена величия</h2><p class="date">Часть I. Начало<br/>2007–2017</p><p class="date">Главы 1–20</p></section>'))
        for c in CHAPTERS:
            body = f'<section epub:type="chapter"><h1>Глава {c["n"]}<br/>{e(c["title"])}</h1><p class="date">{e(c["date"])}</p>'+''.join(f'<p>{e(p)}</p>' for p in c['paragraphs'])+'</section>'
            z.writestr('OEBPS/'+c['id']+'.xhtml',xhtml(c['title'],body))
    with zipfile.ZipFile(DOWNLOADS/'VELT-Part-I.epub') as z:
        assert z.infolist()[0].filename=='mimetype' and z.infolist()[0].compress_type==0
        for name in z.namelist():
            if name.endswith(('.xml','.opf','.ncx','.xhtml','.svg')): ET.fromstring(z.read(name))
        assert len([n for n in z.namelist() if re.search(r'chapter-\d+\.xhtml$',n)])==20


if __name__=='__main__':
    make_site()
    make_epub()
    stats = dict(chapters=20,words=TOTAL,complete_parts=[1],planned_parts=[2,3,4],target_total_words=[250000,350000],target_chapter_words=[2500,4500],chapter_length_target_met=False,epub_structural_check='passed',mibook_device_import_tested=False,per_chapter=[{k:c[k] for k in ('n','title','words','minutes')} for c in CHAPTERS])
    (ROOT/'author'/'STATS.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'manuscript'/'VELT-Part-I.md').write_text('# VELT\n\n## Цена величия\n\n## Часть I. Начало\n\n'+'\n\n'.join((ROOT/'manuscript'/f'{c["n"]:02d}.md').read_text(encoding='utf-8').strip() for c in CHAPTERS)+'\n',encoding='utf-8')
    print(json.dumps({'chapters':20,'words':TOTAL,'epub':'passed'},ensure_ascii=False))
