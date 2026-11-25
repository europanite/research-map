/** Corpus-specific lexical features; no model download or external service. */
const STOP = new Set(`a an the and or nor to from in of on at by with without as is are was were be been being that this these those not which we they it into via between than can could may might must our their its also over under when where how what who whom whose will would should has have had do does did if for while but both each other another more most less such very per et al etc`.split(/\s+/));
const BOILER = new Set(`study studies paper papers research researchers result results finding findings experiment experiments experimental evaluation evaluations approach approaches method methods methodology methodologies technique techniques proposed proposes propose proposing novel new existing previous recent various different several many few important significant effective efficient improved improvement improve better best high low large small overall general specific particular simple basic using used use uses based demonstrate demonstrates demonstrated show shows shown present presents presented introduce introduces introduced investigate investigates investigated provide provides provided achieve achieves achieved obtain obtained analysis analyses analyzed compare compared comparison performance accuracy effectiveness efficiency information work works framework frameworks system systems process processes issue issues problem problems solution solutions task tasks application applications scenario scenarios case cases example examples number numbers value values level levels factor factors figure figures table tables section sections conclusion conclusions further furthermore however therefore thus respective respectively possible potential relevant related including include includes consider considered reported observed observedly`.split(/\s+/));
// These can be useful inside real phrases, but rarely identify a specialty alone.
const BROAD = new Set(`model models algorithm algorithms network networks neural learning machine deep data dataset datasets training trained test testing image images feature features prediction classification optimization detection generation representation representations language intelligence artificial examples example attack attacks robust robustness explanation explanations interpretability`.split(/\s+/));
// Retain the useful technical compounds "adversarial examples", "large language model", etc.
const ESTABLISHED = new Set(['large language model','large language models','deep learning','machine learning','neural network','neural networks','deep neural network','deep neural networks','feature attribution','adversarial examples']);
const PHRASE_OK = new Set(['example','examples','large','small','deep','high','low','analysis','learning','training','detection','optimization','method','methods']);
export function technicalTerms(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const put = (s: string) => out.set(s, (out.get(s) ?? 0) + 1);
  for (const sentence of text.normalize('NFKC').split(/[.!?;,:\n()[\]{}]/u)) {
    const raw = sentence.match(/[\p{L}][\p{L}\p{N}+-]*/gu) ?? [];
    const words = raw.map(w => w.toLowerCase().replace(/-+$/g,''));
    const good = (w: string, i: number) => w.length <= 35 && (w.length >= 3 || /^[A-Z][A-Z0-9+]{1,}$/.test(raw[i])) && !STOP.has(w) && (!BOILER.has(w) || PHRASE_OK.has(w));
    const specific = (w: string) => !BROAD.has(w) && !BOILER.has(w);
    for (let i = 0; i < words.length; i++) {
      if (!good(words[i],i)) continue;
      if (specific(words[i])) put(words[i]);
      for (let len = 2; len <= 3 && i + len <= words.length; len++) {
        const phrase = words.slice(i,i+len);
        if (!phrase.every((w,j) => good(w,i+j))) break;
        if (!phrase.some(specific) && !ESTABLISHED.has(phrase.join(' '))) continue;
        // Avoid glue-like leading/trailing academic vocabulary.
        if (BOILER.has(phrase[len-1]) && !['example','examples','analysis'].includes(phrase[len-1])) continue;
        put(phrase.join(' '));
      }
    }
  }
  return out;
}
