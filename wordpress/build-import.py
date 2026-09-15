from pathlib import Path
import re, html
root=Path(__file__).resolve().parents[1]
base='https://quarterdeckcollective.com/spotter/'
app='https://simeonrinkenberger.github.io/spotter/'
nav='<nav aria-label="Spotter pages"><p><a href="'+base+'">Spotter</a> · <a href="'+base+'privacy/">Privacy policy</a> · <a href="'+base+'terms/">Terms of use</a> · <a href="'+base+'whats-new/">What’s new</a></p></nav>'
home='''<p>By Quarterdeck Collective</p><h2>Save a workout video. Make it your next session.</h2><p>Spotter turns fitness videos into workout cards you can follow and log. Save a link from TikTok, Instagram or YouTube, review the exercises, sets and reps, and train one movement at a time.</p><p><a href="APP">Open Spotter</a></p><h2>Your training, in one place</h2><ul><li>Save and organize workouts with favorites and collections.</li><li>Track sets, reps and weights in Workout Mode.</li><li>Plan your week and review your workout history and progress.</li><li>Ask Pumpy to help build or adapt a workout, then review and confirm its suggested changes.</li></ul><h2>Your account and your data</h2><p>Sign in with email or an available sign-in provider. Your account connects your library, workout logs and settings across Spotter’s web and iPhone apps. Read our <a href="BASEprivacy/">privacy policy</a> to learn what information Spotter uses and how to export or delete your account, and our <a href="BASEterms/">terms of use</a> before using the app.</p><p>Spotter provides fitness guidance. Review extracted workouts before following them.</p><h2>Contact</h2><p>For questions about Spotter or your account, email <a href="mailto:business@quarterdeckcollective.com">business@quarterdeckcollective.com</a>.</p>'''.replace('APP',app).replace('BASE',base)
pages=[(900001,'Spotter','spotter',0,home)]
for i,(file,title,slug) in enumerate([('privacy','Spotter Privacy Policy','privacy'),('terms','Spotter Terms of Use','terms'),('whats-new','Spotter — What’s New','whats-new')],2):
 src=(root/'docs'/f'{file}.html').read_text()
 body=re.search(r'<main>(.*?)</main>',src,re.S).group(1)
 body=re.sub(r'<h1>.*?</h1>','',body,count=1,flags=re.S)
 for old,new in [('privacy.html',base+'privacy/'),('terms.html',base+'terms/'),('whats-new.html',base+'whats-new/'),('./',app)]:
  body=body.replace('href="'+old+'"','href="'+new+'"')
 pages.append((900000+i,title,slug,900001,body))
def cdata(s): return '<![CDATA['+s.replace(']]>',']]]]><![CDATA[>')+']]>'
xml=['''<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/"><channel><title>Spotter</title><link>https://quarterdeckcollective.com</link><description>Spotter public information pages</description><language>en-US</language><wp:wxr_version>1.2</wp:wxr_version><wp:base_site_url>https://quarterdeckcollective.com</wp:base_site_url><wp:base_blog_url>https://quarterdeckcollective.com</wp:base_blog_url><wp:author><wp:author_id>1</wp:author_id><wp:author_login>admin</wp:author_login><wp:author_email></wp:author_email><wp:author_display_name>admin</wp:author_display_name></wp:author>''']
for id,title,slug,parent,body in pages:
 content='<!-- wp:html -->\n<div class="spotter-info" style="max-width:760px;margin:0 auto;line-height:1.7">'+nav+'<h1 style="font-size:clamp(2rem,5vw,3rem);line-height:1.15;text-transform:none">'+html.escape(title)+'</h1>'+body+nav+'</div>\n<!-- /wp:html -->'
 (root/'wordpress'/f'{slug}.html').write_text(content)
 xml.append(f'<item><title>{html.escape(title)}</title><dc:creator>admin</dc:creator><content:encoded>{cdata(content)}</content:encoded><excerpt:encoded></excerpt:encoded><wp:post_id>{id}</wp:post_id><wp:post_date>2026-09-13 00:00:00</wp:post_date><wp:post_date_gmt>2026-09-13 00:00:00</wp:post_date_gmt><wp:comment_status>closed</wp:comment_status><wp:ping_status>closed</wp:ping_status><wp:post_name>{slug}</wp:post_name><wp:status>publish</wp:status><wp:post_parent>{parent}</wp:post_parent><wp:menu_order>0</wp:menu_order><wp:post_type>page</wp:post_type><wp:post_password></wp:post_password><wp:is_sticky>0</wp:is_sticky></item>')
xml.append('</channel></rss>')
p=root/'wordpress'/'spotter-pages.xml';p.write_text('\n'.join(xml))
import xml.etree.ElementTree as ET
ET.parse(p)
print('Built and parsed four public pages:',p)
