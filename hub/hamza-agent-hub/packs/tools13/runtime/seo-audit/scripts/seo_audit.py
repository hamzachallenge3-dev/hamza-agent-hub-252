#!/usr/bin/env python3
"""Free original SEO/GEO auditor. Does NOT call Okara, post to Reddit or contact AI engines."""
import argparse, html.parser, json, sys, re, urllib.request, urllib.parse, socket, ipaddress

class Scan(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title='';self.in_title=False;self.description='';self.robots='';self.canonical='';self.og={};self.lang='';self.h1=[];self.heading=None;self.images=0;self.images_missing_alt=0;self.jsonld=0;self.links=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='html':self.lang=a.get('lang','')
        if tag=='title':self.in_title=True
        if tag=='h1':self.heading=''
        if tag=='img':
            self.images+=1
            if not (a.get('alt') or '').strip():self.images_missing_alt+=1
        if tag=='script' and a.get('type','').lower()=='application/ld+json':self.jsonld+=1
        if tag=='a' and a.get('href'):self.links.append(a['href'])
        if tag=='meta':
            if a.get('name','').lower()=='description':self.description=a.get('content','')
            if a.get('name','').lower()=='robots':self.robots=a.get('content','')
            if a.get('property','').startswith('og:'):self.og[a['property']]=a.get('content','')
        if tag=='link' and 'canonical' in (a.get('rel') or '').lower():self.canonical=a.get('href','')
    def handle_data(self,data):
        if self.in_title:self.title+=data
        if self.heading is not None:self.heading+=data
    def handle_endtag(self,tag):
        if tag=='title':self.in_title=False
        if tag=='h1':self.h1.append((self.heading or '').strip());self.heading=None

def is_public_url(url):
    p=urllib.parse.urlsplit(url)
    if p.scheme not in ('https','http') or not p.hostname:return False
    host=p.hostname.lower()
    if host in ('localhost','local') or host.endswith(('.local','.internal')):return False
    try:
        ip=ipaddress.ip_address(host)
        if not ip.is_global:return False
    except ValueError:
        pass
    return True

class PublicOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        if not is_public_url(newurl):raise ValueError('Redirect to private URL is forbidden')
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def fetch(url):
    if not is_public_url(url):raise ValueError('Not a public HTTP(S) URL')
    opener=urllib.request.build_opener(PublicOnly)
    with opener.open(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (FreeSeoCheck/1.0)'}),timeout=15) as r:
        if r.headers.get('Content-Type','').lower().split(';')[0] not in ('text/html','application/xhtml+xml'):
            raise ValueError('HTML content only')
        return r.read(1024*1024).decode('utf-8',errors='replace')

def analyze(markup,url):
    s=Scan();s.feed(markup)
    checks={'title':bool(s.title.strip()),'meta_description':bool(s.description.strip()),'canonical':bool(s.canonical),'h1_exactly_one':len(s.h1)==1,'image_alts':s.images_missing_alt==0,'html_language':bool(s.lang),'open_graph_title':bool(s.og.get('og:title')),'json_ld':s.jsonld>0}
    advice=[]
    if not checks['title']:advice.append('Add a unique descriptive <title>')
    if not checks['meta_description']:advice.append('Write a helpful page summary in meta description')
    if not checks['canonical']:advice.append('Set a canonical URL to the intended public page')
    if not checks['h1_exactly_one']:advice.append('Use one descriptive H1')
    if not checks['image_alts']:advice.append('Add useful alt text to content images')
    if not checks['html_language']:advice.append('Declare the primary language on the HTML element')
    if not checks['open_graph_title']:advice.append('Add og:title for link previews')
    if not checks['json_ld']:advice.append('Consider factual JSON-LD schema relevant to the page')
    if 'noindex' in s.robots.lower():advice.append('Check the noindex directive (search engines may not index page)')
    return {'url':url,'checks':checks,'basic_technical_score':round(100*sum(checks.values())/len(checks)),'title':s.title.strip(),'meta_description':s.description.strip(),'h1':s.h1,'image_count':s.images,'image_alt_missing':s.images_missing_alt,'schema_blocks':s.jsonld,'outbound_links_count':len(s.links),'recommended_fixes':advice,'geo_note':'Technical signals only. Visibility in ChatGPT/Perplexity/Gemini and rankings are NOT tested; no automated Reddit marketing or posting.'}

def main():
    p=argparse.ArgumentParser(description='Read-only SEO/GEO audit of a public site or local HTML fixture')
    a=p.add_mutually_exclusive_group(required=True);a.add_argument('--url');a.add_argument('--html-file')
    p.add_argument('--display-url',default='https://example.com/');args=p.parse_args()
    try:
        if args.url: markup=fetch(args.url);url=args.url
        else:
            from pathlib import Path
            markup=Path(args.html_file).read_text(encoding='utf-8');url=args.display_url
        print(json.dumps({'ok':True,**analyze(markup,url)},ensure_ascii=False,indent=2))
    except Exception as e:
        print(json.dumps({'ok':False,'error':str(e),'error_type':type(e).__name__}));raise SystemExit(2)
if __name__=='__main__':main()
