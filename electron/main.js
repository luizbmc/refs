const { app, BrowserWindow, ipcMain, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const JSZip = require('jszip');

const URL_CHECK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ABeNiTa/0.1 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
};

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'app', 'icon.ico');
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'ABeNiTa',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
}

function requestUrl(url, method, redirects, originalUrl, wasRedirected) {
  return new Promise((resolve) => {
    const requestedUrl = originalUrl || url;
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      resolve({ url: requestedUrl, ok: false, status: null, finalUrl: url, erro: 'URL invÃ¡lida' });
      return;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request(parsed, {
      method,
      timeout: 10000,
      headers: URL_CHECK_HEADERS
    }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      const finalUrl = location ? new URL(location, parsed).toString() : url;
      res.resume();
      if (location && status >= 300 && status < 400 && redirects < 5) {
        resolve(requestUrl(finalUrl, method, redirects + 1, requestedUrl, true));
        return;
      }
      resolve({
        url: requestedUrl,
        ok: status >= 200 && status < 400,
        status,
        finalUrl,
        redirecionado: !!location || !!wasRedirected
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Timeout'));
    });
    req.on('error', (err) => {
      resolve({ url: requestedUrl, ok: false, status: null, finalUrl: url, erro: err.message || String(err) });
    });
    req.end();
  });
}

async function requestUrlElectron(url, method) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return { url, ok: false, status: null, finalUrl: url, erro: 'URL invÃ¡lida' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await net.fetch(parsed.toString(), {
      method,
      redirect: 'follow',
      headers: URL_CHECK_HEADERS,
      signal: controller.signal
    });
    if (response.body) {
      await response.body.cancel().catch(() => {});
    }
    const finalUrl = response.url || parsed.toString();
    return {
      url,
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      finalUrl,
      redirecionado: finalUrl !== parsed.toString()
    };
  } catch (err) {
    return {
      url,
      ok: false,
      status: null,
      finalUrl: parsed.toString(),
      erro: err?.name === 'AbortError' ? 'Timeout' : (err.message || String(err))
    };
  } finally {
    clearTimeout(timer);
  }
}

async function validarUrl(url) {
  const head = await requestUrlElectron(url, 'HEAD');
  if (head.ok || head.status === 404) return head;

  const get = await requestUrlElectron(url, 'GET');
  if (get.ok || get.status) return get;

  const fallbackHead = await requestUrl(url, 'HEAD', 0);
  if (fallbackHead.ok || fallbackHead.status === 404) return fallbackHead;
  return requestUrl(url, 'GET', 0);
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&');
}

function textoParagrafoComTabs(paragraphXml) {
  const partes = [];
  String(paragraphXml || '').replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>/g, (full, text) => {
    partes.push(/^<w:tab/i.test(full) ? '\t' : decodeXml(text));
    return '';
  });
  return partes.join('').replace(/\s+/g, ' ').trim();
}

function getStyleIdParagrafo(paragraphXml) {
  const match = String(paragraphXml || '').match(/<w:pStyle\b[^>]*\bw:val="([^"]+)"/i);
  return match ? decodeXml(match[1]) : '';
}

function mapaEstilosParagrafo(stylesXml) {
  const mapa = {};
  String(stylesXml || '').replace(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g, (full, attrs, inner) => {
    if (!/\bw:type="paragraph"/i.test(attrs)) return '';
    const id = (attrs.match(/\bw:styleId="([^"]+)"/i) || [])[1] || '';
    const name = (inner.match(/<w:name\b[^>]*\bw:val="([^"]+)"/i) || [])[1] || '';
    if (id) mapa[decodeXml(id)] = decodeXml(name || id);
    return '';
  });
  return mapa;
}

async function extrairEstruturaDocx(arrayBuffer) {
  const buffer = Buffer.from(arrayBuffer);
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) return { paragraphs: [], styles: [] };

  const documentXml = await documentFile.async('string');
  const stylesXml = zip.file('word/styles.xml')
    ? await zip.file('word/styles.xml').async('string')
    : '';
  const estilos = mapaEstilosParagrafo(stylesXml);
  const paragraphs = [];
  String(documentXml || '').replace(/<w:p\b[\s\S]*?<\/w:p>/g, (pXml) => {
    const text = textoParagrafoComTabs(pXml);
    if (!text) return '';
    const styleId = getStyleIdParagrafo(pXml);
    paragraphs.push({
      text,
      styleId,
      styleName: estilos[styleId] || styleId || 'Normal'
    });
    return '';
  });
  const styles = Array.from(new Map(
    paragraphs
      .filter(p => p.styleName)
      .map(p => [p.styleId || p.styleName, { styleId: p.styleId, styleName: p.styleName }])
  ).values());
  return { paragraphs, styles };
}

function encodeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function encodeXmlAttr(text) {
  return encodeXml(text).replace(/"/g, '&quot;');
}

function normalizarBusca(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarNomeEstilo(text) {
  return decodeXml(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function localizarEstilosCaracter(stylesXml) {
  const encontrados = { bold: '', italic: '', boldItalic: '' };
  String(stylesXml || '').replace(/<w:style\b[\s\S]*?<\/w:style>/g, (styleXml) => {
    if (!/\bw:type="character"/.test(styleXml)) return styleXml;
    const id = (styleXml.match(/\bw:styleId="([^"]+)"/) || [])[1] || '';
    const nome = (styleXml.match(/<w:name\b[^>]*\bw:val="([^"]+)"/) || [])[1] || '';
    const normal = normalizarNomeEstilo(nome);
    if (normal === '_zcaractere>negrito') encontrados.bold = decodeXml(id);
    if (normal === '_zcaractere>italico') encontrados.italic = decodeXml(id);
    if (normal === '_zcaractere>negrito-italico') encontrados.boldItalic = decodeXml(id);
    return styleXml;
  });
  return encontrados;
}

function textoRun(runXml) {
  const parts = [];
  runXml.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (m, value) => {
    parts.push(decodeXml(value));
    return m;
  });
  runXml.replace(/<w:tab\b[^>]*\/>/g, () => {
    parts.push('\t');
    return '';
  });
  return parts.join('');
}

function extrairRunProps(runXml) {
  const match = runXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/);
  return match ? match[0] : '';
}

function removerPropsNegritoItalico(rPr) {
  let props = String(rPr || '');
  props = props.replace(/<w:b\b[^>]*(?:\/>|>[\s\S]*?<\/w:b>)/g, '');
  props = props.replace(/<w:bCs\b[^>]*(?:\/>|>[\s\S]*?<\/w:bCs>)/g, '');
  props = props.replace(/<w:i\b[^>]*(?:\/>|>[\s\S]*?<\/w:i>)/g, '');
  props = props.replace(/<w:iCs\b[^>]*(?:\/>|>[\s\S]*?<\/w:iCs>)/g, '');
  return props;
}

function removerRunStyle(rPr) {
  return String(rPr || '').replace(/<w:rStyle\b[^>]*(?:\/>|>[\s\S]*?<\/w:rStyle>)/g, '');
}

function garantirRunProps(rPr) {
  return rPr || '<w:rPr></w:rPr>';
}

function inserirRunProp(rPr, xmlProp) {
  const props = garantirRunProps(rPr);
  return props.replace('</w:rPr>', `${xmlProp}</w:rPr>`);
}

function aplicarPropsNegritoItalico(rPr, segment, charStyles) {
  if (!segment) return rPr || '';
  let props = removerRunStyle(removerPropsNegritoItalico(rPr));
  const hasBoldStyle = !!charStyles?.bold;
  const hasItalicStyle = !!charStyles?.italic;

  if (segment.bold && !segment.italic && hasBoldStyle) {
    return inserirRunProp(props, `<w:rStyle w:val="${encodeXmlAttr(charStyles.bold)}"/>`);
  }
  if (segment.italic && !segment.bold && hasItalicStyle) {
    return inserirRunProp(props, `<w:rStyle w:val="${encodeXmlAttr(charStyles.italic)}"/>`);
  }

  if (segment.bold && segment.italic) {
    if (charStyles?.boldItalic) {
      return inserirRunProp(props, `<w:rStyle w:val="${encodeXmlAttr(charStyles.boldItalic)}"/>`);
    }
    if (hasBoldStyle) {
      props = inserirRunProp(props, `<w:rStyle w:val="${encodeXmlAttr(charStyles.bold)}"/>`);
      return inserirRunProp(props, '<w:i/><w:iCs/>');
    }
    if (hasItalicStyle) {
      props = inserirRunProp(props, `<w:rStyle w:val="${encodeXmlAttr(charStyles.italic)}"/>`);
      return inserirRunProp(props, '<w:b/><w:bCs/>');
    }
  }

  if (segment.bold) props = inserirRunProp(props, '<w:b/><w:bCs/>');
  if (segment.italic) props = inserirRunProp(props, '<w:i/><w:iCs/>');
  if (!segment.bold && !segment.italic) {
    props = props === '<w:rPr></w:rPr>' ? '' : props;
  }
  return props;
}

function criarRun(text, baseRPr, segment, charStyles) {
  if (!text) return '';
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  const props = aplicarPropsNegritoItalico(baseRPr, segment, charStyles);
  return `<w:r>${props}<w:t${preserve}>${encodeXml(text)}</w:t></w:r>`;
}

function segmentosHtml(html) {
  const segments = [];
  let bold = false;
  let italic = false;
  let cursor = 0;
  const re = /<(\/?)(strong|b|em|i|br)\b[^>]*>/gi;
  let match;

  function pushText(value) {
    const text = decodeXml(value);
    if (!text) return;
    segments.push({ text, bold, italic });
  }

  while ((match = re.exec(String(html || '')))) {
    if (match.index > cursor) pushText(String(html || '').slice(cursor, match.index));
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    if (tag === 'br') {
      pushText('\n');
    } else if (tag === 'strong' || tag === 'b') {
      bold = !closing;
    } else if (tag === 'em' || tag === 'i') {
      italic = !closing;
    }
    cursor = re.lastIndex;
  }
  if (cursor < String(html || '').length) pushText(String(html || '').slice(cursor));
  return segments;
}

function encontrarIndiceNormalizado(text, target) {
  const normalText = String(text || '').replace(/\u00a0/g, ' ');
  const normalTarget = String(target || '').replace(/\u00a0/g, ' ');
  return normalText.indexOf(normalTarget);
}

function extrairRuns(paragraphXml) {
  const runs = [];
  paragraphXml.replace(/<w:r\b[\s\S]*?<\/w:r>/g, (xml, offset) => {
    const text = textoRun(xml);
    if (!text) return xml;
    const start = runs.length ? runs[runs.length - 1].end : 0;
    runs.push({ xml, offset, text, start, end: start + text.length, rPr: extrairRunProps(xml) });
    return xml;
  });
  return runs;
}

function textoParagrafoXml(paragraphXml) {
  return extrairRuns(paragraphXml).map(run => run.text).join('');
}

function substituirEmParagrafo(paragraphXml, antes, depoisHtml, charStyles) {
  const runs = extrairRuns(paragraphXml);
  const paragraphText = runs.map(run => run.text).join('');
  const start = encontrarIndiceNormalizado(paragraphText, antes);
  if (start < 0) return null;
  const end = start + String(antes || '').replace(/\u00a0/g, ' ').length;
  const overlapRuns = runs.filter(run => run.end > start && run.start < end);
  if (!overlapRuns.length) return null;

  const replacementSegments = segmentosHtml(depoisHtml);
  const baseRPr = overlapRuns[0].rPr;
  let inserted = false;
  const pieces = [];
  let cursor = 0;

  runs.forEach(run => {
    pieces.push(paragraphXml.slice(cursor, run.offset));
    const overlaps = run.end > start && run.start < end;
    if (!overlaps) {
      pieces.push(run.xml);
      cursor = run.offset + run.xml.length;
      return;
    }

    const prefixLen = Math.max(0, start - run.start);
    const suffixStart = Math.max(0, end - run.start);
    const prefix = prefixLen > 0 ? run.text.slice(0, prefixLen) : '';
    const suffix = suffixStart < run.text.length ? run.text.slice(suffixStart) : '';

    if (prefix) pieces.push(criarRun(prefix, run.rPr, null, charStyles));
    if (!inserted) {
      replacementSegments.forEach(segment => {
        pieces.push(criarRun(segment.text, baseRPr, segment, charStyles));
      });
      inserted = true;
    }
    if (suffix) pieces.push(criarRun(suffix, run.rPr, null, charStyles));
    cursor = run.offset + run.xml.length;
  });

  pieces.push(paragraphXml.slice(cursor));
  return pieces.join('');
}

function criarRunComentarioReference(commentId) {
  return `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${commentId}"/></w:r>`;
}

function inserirComentarioEmParagrafo(paragraphXml, alvo, commentId, charStyles) {
  const runs = extrairRuns(paragraphXml);
  const paragraphText = runs.map(run => run.text).join('');
  const start = encontrarIndiceNormalizado(paragraphText, alvo);
  if (start < 0) return null;
  const end = start + String(alvo || '').replace(/\u00a0/g, ' ').length;
  const overlapRuns = runs.filter(run => run.end > start && run.start < end);
  if (!overlapRuns.length) return null;

  let opened = false;
  let closed = false;
  const pieces = [];
  let cursor = 0;

  runs.forEach(run => {
    pieces.push(paragraphXml.slice(cursor, run.offset));
    const overlaps = run.end > start && run.start < end;
    if (!overlaps) {
      pieces.push(run.xml);
      cursor = run.offset + run.xml.length;
      return;
    }

    const prefixLen = Math.max(0, start - run.start);
    const middleStart = Math.max(0, start - run.start);
    const middleEnd = Math.min(run.text.length, end - run.start);
    const suffixStart = Math.max(0, end - run.start);
    const prefix = prefixLen > 0 ? run.text.slice(0, prefixLen) : '';
    const middle = middleEnd > middleStart ? run.text.slice(middleStart, middleEnd) : '';
    const suffix = suffixStart < run.text.length ? run.text.slice(suffixStart) : '';

    if (prefix) pieces.push(criarRun(prefix, run.rPr, null, charStyles));
    if (middle) {
      if (!opened) {
        pieces.push(`<w:commentRangeStart w:id="${commentId}"/>`);
        opened = true;
      }
      pieces.push(criarRun(middle, run.rPr, null, charStyles));
    }

    const isLastOverlap = run.end >= end;
    if (opened && !closed && isLastOverlap) {
      pieces.push(`<w:commentRangeEnd w:id="${commentId}"/>`);
      pieces.push(criarRunComentarioReference(commentId));
      closed = true;
    }
    if (suffix) pieces.push(criarRun(suffix, run.rPr, null, charStyles));
    cursor = run.offset + run.xml.length;
  });

  pieces.push(paragraphXml.slice(cursor));
  return opened && closed ? pieces.join('') : null;
}

function aplicarCorrecoesDocumentXml(documentXml, correcoes, charStyles) {
  const aplicadas = [];
  const ignoradas = [];
  let xml = documentXml;

  (correcoes || []).forEach((correcao, index) => {
    const antes = correcao.antes || '';
    const depoisHtml = correcao.depoisHtml || correcao.depois || '';
    if (!normalizarBusca(antes) || !normalizarBusca(correcao.depois || depoisHtml)) {
      ignoradas.push({ index, motivo: 'CorreÃ§Ã£o vazia.' });
      return;
    }

    const antesNormalizado = normalizarBusca(antes);
    const paragrafoNormalizado = normalizarBusca(correcao.paragrafoAntes || '');
    const tentarSubstituir = (exigirParagrafo) => {
      let substituiuNestaPassagem = false;
      xml = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
        if (substituiuNestaPassagem) return paragraphXml;
        const textoNormalizado = normalizarBusca(textoParagrafoXml(paragraphXml));
        if (!textoNormalizado.includes(antesNormalizado)) return paragraphXml;
        if (exigirParagrafo && paragrafoNormalizado && !textoNormalizado.includes(paragrafoNormalizado)) {
          return paragraphXml;
        }
        const novo = substituirEmParagrafo(paragraphXml, antes, depoisHtml, charStyles);
        if (!novo || novo === paragraphXml) return paragraphXml;
        substituiuNestaPassagem = true;
        return novo;
      });
      return substituiuNestaPassagem;
    };

    let substituiu = paragrafoNormalizado ? tentarSubstituir(true) : false;
    if (!substituiu) substituiu = tentarSubstituir(false);

    if (substituiu) aplicadas.push({ index, antes: correcao.antes, depois: correcao.depois });
    else ignoradas.push({ index, antes: correcao.antes, motivo: 'Texto anterior nÃ£o encontrado no DOCX.' });
  });

  return { xml, aplicadas, ignoradas };
}

function maxCommentId(commentsXml) {
  let max = -1;
  String(commentsXml || '').replace(/<w:comment\b[^>]*\bw:id="(\d+)"/g, (m, id) => {
    max = Math.max(max, Number(id));
    return m;
  });
  return max;
}

function criarCommentsXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:comments>';
}

function criarCommentXml(commentId, autor, comentario) {
  const date = new Date().toISOString();
  return `<w:comment w:id="${commentId}" w:author="${encodeXmlAttr(autor || 'ABeNiTa')}" w:date="${encodeXmlAttr(date)}">` +
    `<w:p><w:r><w:t>${encodeXml(comentario || '')}</w:t></w:r></w:p>` +
    '</w:comment>';
}

function adicionarComentariosXml(commentsXml, comentariosComId) {
  let xml = commentsXml || criarCommentsXml();
  const insercoes = comentariosComId
    .map(item => criarCommentXml(item.commentId, item.autor, item.comentario))
    .join('');
  if (/<\/w:comments>\s*$/.test(xml)) {
    return xml.replace(/<\/w:comments>\s*$/, `${insercoes}</w:comments>`);
  }
  return criarCommentsXml().replace('</w:comments>', `${insercoes}</w:comments>`);
}

function garantirCommentsContentType(contentTypesXml) {
  if (/PartName="\/word\/comments\.xml"/.test(contentTypesXml)) return contentTypesXml;
  const override = '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>';
  return contentTypesXml.replace(/<\/Types>\s*$/, `${override}</Types>`);
}

function garantirCommentsRel(relsXml) {
  const type = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
  if (relsXml.includes(type)) return relsXml;
  let max = 0;
  relsXml.replace(/\bId="rId(\d+)"/g, (m, id) => {
    max = Math.max(max, Number(id));
    return m;
  });
  const rel = `<Relationship Id="rId${max + 1}" Type="${type}" Target="comments.xml"/>`;
  return relsXml.replace(/<\/Relationships>\s*$/, `${rel}</Relationships>`);
}

function aplicarComentariosDocumentXml(documentXml, comentarios, startId, charStyles) {
  const inseridos = [];
  const ignorados = [];
  let xml = documentXml;
  let nextId = startId;

  (comentarios || []).forEach((comentario, index) => {
    const alvo = comentario.alvo || '';
    if (!normalizarBusca(alvo) || !normalizarBusca(comentario.comentario)) {
      ignorados.push({ index, motivo: 'ComentÃ¡rio vazio ou alvo vazio.' });
      return;
    }
    const commentId = nextId;
    const alvoNormalizado = normalizarBusca(alvo);
    const paragrafoNormalizado = normalizarBusca(comentario.paragrafoAntes || '');
    const tentarInserir = (exigirParagrafo) => {
      let substituiuNestaPassagem = false;
      xml = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
        if (substituiuNestaPassagem) return paragraphXml;
        const textoNormalizado = normalizarBusca(textoParagrafoXml(paragraphXml));
        if (!textoNormalizado.includes(alvoNormalizado)) return paragraphXml;
        if (exigirParagrafo && paragrafoNormalizado && !textoNormalizado.includes(paragrafoNormalizado)) {
          return paragraphXml;
        }
        const novo = inserirComentarioEmParagrafo(paragraphXml, alvo, commentId, charStyles);
        if (!novo || novo === paragraphXml) return paragraphXml;
        substituiuNestaPassagem = true;
        return novo;
      });
      return substituiuNestaPassagem;
    };

    let substituiu = paragrafoNormalizado ? tentarInserir(true) : false;
    if (!substituiu) substituiu = tentarInserir(false);

    if (substituiu) {
      inseridos.push({ ...comentario, commentId });
      nextId += 1;
    } else {
      ignorados.push({ index, alvo, motivo: 'Texto alvo do comentÃ¡rio nÃ£o encontrado no DOCX.' });
    }
  });

  return { xml, inseridos, ignorados, nextId };
}

ipcMain.handle('refs:validarUrls', async (event, urls) => {
  const lista = Array.isArray(urls) ? urls : [];
  const resultados = [];
  for (let i = 0; i < lista.length; i += 1) {
    resultados.push(await validarUrl(lista[i]));
  }
  return resultados;
});

ipcMain.handle('refs:extrairEstruturaDocx', async (event, payload) => {
  try {
    if (!payload?.arrayBuffer) return { ok: false, erro: 'O DOCX não está carregado.' };
    const estrutura = await extrairEstruturaDocx(payload.arrayBuffer);
    return { ok: true, ...estrutura };
  } catch (err) {
    return { ok: false, erro: err?.message || String(err) };
  }
});

ipcMain.handle('refs:exportarDocxCorrigido', async (event, payload) => {
  const correcoes = Array.isArray(payload?.correcoes) ? payload.correcoes : [];
  const comentarios = Array.isArray(payload?.comentarios) ? payload.comentarios : [];
  if (!correcoes.length && !comentarios.length) {
    return { ok: false, erro: 'Não há correções ou comentários para aplicar.' };
  }

  const arrayBuffer = payload?.arrayBuffer;
  if (!arrayBuffer) {
    return { ok: false, erro: 'O DOCX original não está carregado.' };
  }

  const originalName = String(payload?.fileName || 'refs-corrigido.docx').replace(/\.docx$/i, '');
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Salvar DOCX corrigido',
    defaultPath: `${originalName}-corrigido.docx`,
    filters: [{ name: 'Documento Word', extensions: ['docx'] }]
  });
  if (canceled || !filePath) return { ok: false, cancelado: true };

  const buffer = Buffer.from(arrayBuffer);
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    return { ok: false, erro: 'word/document.xml não encontrado no DOCX.' };
  }

  const documentXml = await documentFile.async('string');
  const stylesXml = zip.file('word/styles.xml')
    ? await zip.file('word/styles.xml').async('string')
    : '';
  const charStyles = localizarEstilosCaracter(stylesXml);
  const resultado = aplicarCorrecoesDocumentXml(documentXml, correcoes, charStyles);
  let documentXmlFinal = resultado.xml;

  let comentariosResultado = { inseridos: [], ignorados: [] };
  if (comentarios.length) {
    const commentsFile = zip.file('word/comments.xml');
    const commentsXml = commentsFile ? await commentsFile.async('string') : criarCommentsXml();
    comentariosResultado = aplicarComentariosDocumentXml(documentXmlFinal, comentarios, maxCommentId(commentsXml) + 1, charStyles);
    documentXmlFinal = comentariosResultado.xml;
    if (comentariosResultado.inseridos.length) {
      zip.file('word/comments.xml', adicionarComentariosXml(commentsXml, comentariosResultado.inseridos));
      const relsPath = 'word/_rels/document.xml.rels';
      const relsXml = zip.file(relsPath)
        ? await zip.file(relsPath).async('string')
        : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      zip.file(relsPath, garantirCommentsRel(relsXml));
      const contentTypesPath = '[Content_Types].xml';
      const contentTypesXml = await zip.file(contentTypesPath).async('string');
      zip.file(contentTypesPath, garantirCommentsContentType(contentTypesXml));
    }
  }

  zip.file('word/document.xml', documentXmlFinal);
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await fs.promises.writeFile(filePath, output);
  return {
    ok: true,
    filePath,
    aplicadas: resultado.aplicadas.length,
    comentariosInseridos: comentariosResultado.inseridos.length,
    estilosCaracter: charStyles,
    ignoradas: resultado.ignoradas.concat(comentariosResultado.ignorados || [])
  };
});
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
