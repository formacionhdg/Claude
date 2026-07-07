// Nodo: Filtrar y Deduplicar
// Workflow: Radar Ofertas Docentes - 10AM
// n8n: n8n.luxellency.com

const allItems = $input.all();

// Rol docente
const KW_DOCENTE = [
  'formador','formadora','docente','tutor','tutora',
  'instructor','instructora','facilitador',
  'formacion','teleformacion','e-learning',
  'profesor','profesora'
];

// Familias formativas reales de Helena (términos descriptivos completos)
const KW_FAMILIA = [
  'inteligencia artificial','ia aplicada','ia generativa','chatgpt','copilot','llm',
  'marketing digital','marketing online','redes sociales','seo','sem',
  'transformacion digital','automatizacion','digitalizacion',
  'turismo','hosteleria','hoteleria','agencia de viajes',
  'asistencia a la direccion','secretariado','administracion',
  'ofimatica','excel','microsoft 365','power bi','looker',
  'protocolo','hospitalidad'
];

// Indicadores de formación de adultos / FP para el empleo (no decide solo, reservado para uso futuro)
const KW_ADULTOS = [
  'certificado de profesionalidad','fundae','sepe',
  'formacion profesional para el empleo','formacion para empresas',
  'formacion continua','in-company','aula virtual','moodle',
  'trabajadores en activo','pyme','autonomo','accion formativa'
];

// Exclusiones: docencia reglada / académica
const KW_EXCLUIR = [
  'eso','bachillerato','primaria','secundaria','educacion infantil',
  'aneca','catedratico','oposicion','oposiciones',
  'phd','tesis doctoral','investigador',
  'colegio internacional','escuela de idiomas',
  'docente universitario','profesor universitario',
  'facultad','master universitario','grado universitario',
  // Becas: inequívocamente no son puestos docentes
  'becario','becaria'
];

const strip = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Coincidencia de PALABRA COMPLETA (con límites), no de substring.
const containsWord = (text, keyword) => {
  const escaped = strip(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('\\b' + escaped + '\\b', 'i');
  return re.test(text);
};
const matchesAny = (text, keywords) => keywords.some(k => containsWord(text, k));

const normalize = (d) => {
  if (d._source === 'serpapi' && !d._empty && d.title) {
    const ext   = d.detected_extensions || {};
    const alink = d.apply_link
      || (d.apply_options && d.apply_options[0]?.link)
      || (d.related_links && d.related_links[0]?.link)
      || '';
    return {
      _id:   'srp_' + (d.job_id || strip(d.title)).replace(/[^a-zA-Z0-9]/g,'').slice(0,40),
      title: d.title,
      company: d.company_name || '',
      location: d.location || '',
      link: alink,
      pubDate: ext.posted_at || '',
      description: d.description || '',
      telework: ext.work_from_home ? 'remote' : '',
      salary_text: ext.salary || '',
      source: 'Google Jobs'
    };
  }
  if (d._source === 'adzuna' && !d._empty && d.title) {
    const salMin = d.salary_min ? Math.round(d.salary_min) : null;
    const salMax = d.salary_max ? Math.round(d.salary_max) : null;
    const salText = salMin ? (salMax && salMax !== salMin ? salMin + '€-' + salMax + '€' : salMin + '€') : '';
    return {
      _id:   'adz_' + (d.id || strip(d.title)).replace(/[^a-zA-Z0-9]/g,'').slice(0,40),
      title: d.title,
      company: d.company?.display_name || '',
      location: d.location?.display_name || '',
      link: d.redirect_url || '',
      pubDate: d.created || '',
      description: d.description || '',
      telework: '',
      salary_text: salText,
      source: 'Adzuna'
    };
  }
  return null;
};

const isWithin24h = (pub) => {
  if (!pub) return true;
  const t = String(pub).trim().toLowerCase();

  // Publicado hoy o hace pocas horas (inglés y español)
  if (/\d+\s*h(our)?|just\s+post|today|hoy/.test(t)) return true;
  // "hace 1 día" / "1 day ago"
  if (/^1\s+day|hace\s+1\s+d[ií]a|hace\s+un\s+d[ií]a/.test(t)) return true;

  // "hace 2 días" / "2 days" — aceptar (ventana de 3 días para tener volumen de SerpAPI)
  if (/^2\s+day|hace\s+2\s+d[ií]a/.test(t)) return true;
  if (/^2\s+d[ií]a/.test(t)) return true;
  // 3+ días: descartar
  if (/[3-9]\s+day|\bweek|\bmonth|\byear/.test(t)) return false;
  if (/hace\s+[3-9]\s+d[ií]a/.test(t)) return false;
  if (/^[3-9]\s+d[ií]a/.test(t)) return false;

  // Fallback: fecha ISO (Adzuna devuelve ISO 8601)
  try {
    const diff = (new Date() - new Date(pub)) / 3600000;
    return isNaN(diff) ? true : diff <= 72;
  } catch(e) { return true; }
};

const isAutonomo = (text) =>
  /autono|mercantil|freelance|contrato\s+de\s+serv|por\s+cuenta\s+propia|factura|honorari/.test(strip(text));

const extractHourly = (text) => {
  if (!text) return null;
  const t = text.replace(/\./g,'').replace(',','.').toLowerCase();
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:€|eur)\s*(?:\/|por\s+)h(?:ora)?/);
  if (m) return parseFloat(m[1]);
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:€|eur)\s*(?:\/|al\s+|por\s+)mes/);
  if (m) return parseFloat(m[1]) / 160;
  m = t.match(/(\d{4,6}(?:\.\d+)?)\s*(?:€|eur)/);
  if (m && parseFloat(m[1]) > 5000) return parseFloat(m[1]) / 1800;
  return null;
};

const shouldDiscard = (item) => {
  if (item.category === 'tutorizacion') return false;
  const fullText = item.title + ' ' + item.description + ' ' + item.salary_text;
  if (!isAutonomo(fullText)) return false;
  const rate = extractHourly(fullText);
  if (rate === null) return false;
  return rate < 20;
};

const normalized = allItems.map(i => normalize(i.json)).filter(Boolean);

const seenInRun = new Set();
const unique = normalized.filter(item => {
  if (seenInRun.has(item._id)) return false;
  seenInRun.add(item._id);
  return true;
});

const sd = $getWorkflowStaticData('global');
if (!sd.seenIds) sd.seenIds = [];
if (sd.seenIds.length > 800) sd.seenIds = sd.seenIds.slice(-800);
const newItems = unique.filter(item => !sd.seenIds.includes(item._id));
sd.seenIds.push(...newItems.map(i => i._id));

const recent = newItems.filter(item => isWithin24h(item.pubDate));

const relevant = recent.filter(item => {
  const text = strip(item.title + ' ' + item.description + ' ' + item.company);
  if (matchesAny(text, KW_EXCLUIR)) return false;
  // Excluir si el TÍTULO empieza por "practicas" → son puestos de becario, no docentes
  // (no se usa KW_EXCLUIR para evitar bloquear descripciones con "prácticas formativas")
  if (/^practicas\b/.test(strip(item.title))) return false;
  const hasDocente = matchesAny(text, KW_DOCENTE);
  const hasFamilia = matchesAny(text, KW_FAMILIA);
  return hasDocente && hasFamilia;
});

const categorized = relevant.map(item => {
  const t = strip(item.title + ' ' + item.description + ' ' + item.telework);
  let category = 'presencial';
  if (/\btutor(a|izacion)?\b/.test(t)) category = 'tutorizacion';
  else if (/online|teleformac|teletrabajo|a\s+distancia|e.?learning|remoto/.test(t)) category = 'online';
  return { ...item, category, _hasResults: true };
});

const final = categorized.filter(item => !shouldDiscard(item));

return final.length > 0
  ? final.map(item => ({ json: item }))
  : [{ json: { _hasResults: false } }];
