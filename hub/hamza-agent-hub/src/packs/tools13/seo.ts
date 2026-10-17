/** Port of Free Marketing SEO Audit — local HTML analysis (no Okara). */

export interface SeoResult {
  ok: boolean;
  url: string;
  checks: Record<string, boolean>;
  basic_technical_score: number;
  title: string;
  meta_description: string;
  h1: string[];
  image_count: number;
  image_alt_missing: number;
  schema_blocks: number;
  outbound_links_count: number;
  recommended_fixes: string[];
  geo_note: string;
  error?: string;
}

export function seoAuditHtml(html: string, url = 'https://example.com/'): SeoResult {
  try {
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    const description =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] ||
      '';
    const robots =
      html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i)?.[1] || '';
    const canonical =
      html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1] || '';
    const lang = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] || '';
    const ogTitle =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)?.[1] || '';
    const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
      m[1]!.replace(/<[^>]+>/g, '').trim()
    );
    const imgs = [...html.matchAll(/<img\b[^>]*>/gi)];
    let missingAlt = 0;
    for (const img of imgs) {
      const tag = img[0];
      const alt = tag.match(/\balt=["']([^"']*)["']/i);
      if (!alt || !alt[1]!.trim()) missingAlt += 1;
    }
    const jsonld = [...html.matchAll(/application\/ld\+json/gi)].length;
    const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].length;

    const checks: Record<string, boolean> = {
      title: Boolean(title),
      meta_description: Boolean(description.trim()),
      canonical: Boolean(canonical),
      h1_exactly_one: h1.length === 1,
      image_alts: missingAlt === 0,
      html_language: Boolean(lang),
      open_graph_title: Boolean(ogTitle),
      json_ld: jsonld > 0,
    };
    const advice: string[] = [];
    if (!checks.title) advice.push('Add a unique descriptive <title>');
    if (!checks.meta_description) advice.push('Write a helpful page summary in meta description');
    if (!checks.canonical) advice.push('Set a canonical URL to the intended public page');
    if (!checks.h1_exactly_one) advice.push('Use one descriptive H1');
    if (!checks.image_alts) advice.push('Add useful alt text to content images');
    if (!checks.html_language) advice.push('Declare the primary language on the HTML element');
    if (!checks.open_graph_title) advice.push('Add og:title for link previews');
    if (!checks.json_ld) advice.push('Consider factual JSON-LD schema relevant to the page');
    if (robots.toLowerCase().includes('noindex')) {
      advice.push('Check the noindex directive (search engines may not index page)');
    }

    const values = Object.values(checks);
    return {
      ok: true,
      url,
      checks,
      basic_technical_score: Math.round((100 * values.filter(Boolean).length) / values.length),
      title,
      meta_description: description.trim(),
      h1,
      image_count: imgs.length,
      image_alt_missing: missingAlt,
      schema_blocks: jsonld,
      outbound_links_count: links,
      recommended_fixes: advice,
      geo_note:
        'Technical signals only. Visibility in ChatGPT/Perplexity/Gemini and rankings are NOT tested.',
    };
  } catch (err) {
    return {
      ok: false,
      url,
      checks: {},
      basic_technical_score: 0,
      title: '',
      meta_description: '',
      h1: [],
      image_count: 0,
      image_alt_missing: 0,
      schema_blocks: 0,
      outbound_links_count: 0,
      recommended_fixes: [],
      geo_note: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
