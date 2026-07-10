const editor = document.getElementById('editor')
const docxInput = document.getElementById('docxInput')
const runBtn = document.getElementById('runBtn')
const clearBtn = document.getElementById('clearBtn')
const pasteModeBtn = document.getElementById('pasteModeBtn')
const manualReplaceBtn = document.getElementById('manualReplaceBtn')
const manualCommentBtn = document.getElementById('manualCommentBtn')
const occurrencesEl = document.getElementById('occurrences')
const countBadge = document.getElementById('countBadge')
const filtersEl = document.getElementById('filters')
const dropZone = document.getElementById('dropZone')
const summaryEl = document.getElementById('summary')
const sourceModal = document.getElementById('sourceModal')
const sourceModalTitle = document.getElementById('sourceModalTitle')
const sourceModalClose = document.getElementById('sourceModalClose')
const sourceModalCitation = document.getElementById('sourceModalCitation')
const sourceModalBody = document.getElementById('sourceModalBody')
const referencesListEl = document.getElementById('referencesList')
const referencesCountEl = document.getElementById('referencesCount')
const validateUrlsBtn = document.getElementById('validateUrlsBtn')
const exportCorrectedBtn = document.getElementById('exportCorrectedBtn')
const textSearchInput = document.getElementById('textSearchInput')
const textSearchCaseBtn = document.getElementById('textSearchCaseBtn')
const textSearchPrevBtn = document.getElementById('textSearchPrevBtn')
const textSearchNextBtn = document.getElementById('textSearchNextBtn')
const textSearchCount = document.getElementById('textSearchCount')
const chapterNav = document.getElementById('chapterNav')
const chapterSetupModal = document.getElementById('chapterSetupModal')
const chapterStyleSelect = document.getElementById('chapterStyleSelect')
const chapterStylePreview = document.getElementById('chapterStylePreview')
const chapterSetupContinue = document.getElementById('chapterSetupContinue')
const chapterSetupSingle = document.getElementById('chapterSetupSingle')

let occurrences = []
let activeFilter = 'todos'
let activeOccurrenceId = null
let ultimoResultado = null
let urlValidationState = {}
let urlValidationRunning = false
let sourceModalOccurrenceId = null
let sourceModalItem = null
let correcoesAplicadas = []
let comentariosAplicados = []
let comentarioAutorPadrao = ''
let importedDocxArrayBuffer = null
let importedDocxName = ''
let buscaTextoDiferenciarCaixa = false
let buscaTextoMatches = []
let buscaTextoIndiceAtivo = -1
let buscaTextoNavegou = false
let selecaoManualAtual = null
let comentarioManualAtual = null
let docxParagraphMeta = []
let chapterScopes = []
let activeChapterIndex = -1
let pendingChapterSetup = null

const YEAR_RE = /(?:19|20)\d{2}[a-z]?/i
const YEAR_GLOBAL_RE = /(?:19|20)\d{2}[a-z]?/gi
const MESES_ABNT_RE = /(?:jan\.|fev\.|mar\.|abr\.|maio|jun\.|jul\.|ago\.|set\.|out\.|nov\.|dez\.)/i
const DIA_ACESSO_ABNT_RE = /(?:1º|[2-9]|[12]\d|3[01])/
const AGNOMES_AUTOR = ['FILHO', 'NETO', 'JUNIOR', 'JR', 'SOBRINHO']
const ABNT_TIPOS = {
  livro: 'Livro/monografia',
  capitulo: 'Parte de monografia',
  artigoPeriodico: 'Artigo de periódico',
  jornal: 'Artigo de jornal',
  tese: 'Trabalho acadêmico',
  site: 'Documento online',
  legislacao: 'Documento jurídico',
  evento: 'Evento',
  audiovisual: 'Documento audiovisual',
  citacao: 'Citação',
  desconhecido: 'Tipo não classificado',
}

function escHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatIssueHtml(text) {
  return escHtml(text)
    .replace(/&lt;i&gt;/g, '<i>')
    .replace(/&lt;\/i&gt;/g, '</i>')
}

function normalizarTexto(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[“”‘’"']/g, '')
    .replace(/\bet\s+al\.?/gi, ' et al')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function normalizarEspacos(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ORGAOS_SIGLAS = (Array.isArray(window.REFS_ORGAOS_SIGLAS) ? window.REFS_ORGAOS_SIGLAS : [])
  .map(item => ({
    sigla: normalizarTexto(item.sigla),
    nome: normalizarTexto(item.nome),
  }))
  .filter(item => item.sigla && item.nome)

function textoNormalContemTermo(normalText, normalTerm) {
  if (!normalText || !normalTerm) return false
  return ` ${normalText} `.includes(` ${normalTerm} `)
}

function variantesInstitucionaisAutor(author) {
  const normal = normalizarTexto(author)
  if (!normal || !ORGAOS_SIGLAS.length) return []
  const variantes = []
  ORGAOS_SIGLAS.forEach(item => {
    if (textoNormalContemTermo(normal, item.sigla) || textoNormalContemTermo(normal, item.nome)) {
      variantes.push(item.sigla, item.nome)
    }
  })
  return Array.from(new Set(variantes))
}

function normalizarParagrafoHtml(text) {
  const parts = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
  return parts.length
    ? parts.map(p => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
    : '<p></p>'
}

function blocosTexto() {
  return Array.from(editor.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6'))
}

function textoBloco(el) {
  return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()
}

function chaveTextoBloco(text) {
  return normalizarTexto(text).slice(0, 120)
}

function anexarMetadadosParagrafos(paragraphs) {
  docxParagraphMeta = Array.isArray(paragraphs) ? paragraphs : []
  const metas = docxParagraphMeta
    .map((meta, index) => ({ ...meta, index, key: chaveTextoBloco(meta.text) }))
    .filter(meta => meta.key)
  const usados = new Set()
  blocosTexto().forEach((block, blockIndex) => {
    block.dataset.blockIndex = String(blockIndex)
    const key = chaveTextoBloco(textoBloco(block))
    let foundIndex = -1
    for (let i = 0; i < metas.length; i += 1) {
      if (usados.has(i)) continue
      if (metas[i].key === key || metas[i].key.includes(key) || key.includes(metas[i].key)) {
        foundIndex = i
        break
      }
    }
    if (foundIndex < 0) return
    usados.add(foundIndex)
    const meta = metas[foundIndex]
    block.dataset.docxParagraphIndex = String(meta.index)
    block.dataset.styleId = meta.styleId || ''
    block.dataset.styleName = meta.styleName || ''
  })
}

function limparMarcasBuscaTexto() {
  editor.querySelectorAll('span.text-search-mark').forEach(mark => {
    mark.replaceWith(...Array.from(mark.childNodes))
  })
  editor.normalize()
  buscaTextoMatches = []
  buscaTextoIndiceAtivo = -1
  buscaTextoNavegou = false
  atualizarContadorBuscaTexto()
}

function atualizarContadorBuscaTexto() {
  if (!textSearchCount) return
  const total = buscaTextoMatches.length
  textSearchCount.textContent = total && buscaTextoIndiceAtivo >= 0
    ? `${buscaTextoIndiceAtivo + 1}/${total}`
    : `0/${total}`
  textSearchPrevBtn?.toggleAttribute('disabled', !total)
  textSearchNextBtn?.toggleAttribute('disabled', !total)
}

function textNodesBuscaTexto(root) {
  const nodes = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest('.text-search-mark, script, style, button, input, textarea')) {
        return NodeFilter.FILTER_REJECT
      }
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let node
  while ((node = walker.nextNode())) nodes.push(node)
  return nodes
}

function aplicarMarcasBuscaTexto(query) {
  const termo = buscaTextoDiferenciarCaixa ? query : query.toLowerCase()
  let contador = 0
  textNodesBuscaTexto(editor).forEach(node => {
    const original = node.nodeValue || ''
    const alvo = buscaTextoDiferenciarCaixa ? original : original.toLowerCase()
    const ranges = []
    let start = 0
    while (termo && start <= alvo.length) {
      const index = alvo.indexOf(termo, start)
      if (index < 0) break
      ranges.push({ start: index, end: index + termo.length })
      start = index + Math.max(termo.length, 1)
    }
    if (!ranges.length) return

    const fragment = document.createDocumentFragment()
    let cursor = 0
    ranges.forEach(range => {
      if (range.start > cursor) fragment.appendChild(document.createTextNode(original.slice(cursor, range.start)))
      const mark = document.createElement('span')
      mark.className = 'text-search-mark'
      mark.dataset.searchIndex = String(contador++)
      mark.textContent = original.slice(range.start, range.end)
      fragment.appendChild(mark)
      cursor = range.end
    })
    if (cursor < original.length) fragment.appendChild(document.createTextNode(original.slice(cursor)))
    node.parentNode.replaceChild(fragment, node)
  })
  buscaTextoMatches = Array.from(editor.querySelectorAll('.text-search-mark'))
}

function ativarResultadoBuscaTexto(index, options) {
  const deveNavegar = options?.navegar !== false
  if (!buscaTextoMatches.length) {
    buscaTextoIndiceAtivo = -1
    atualizarContadorBuscaTexto()
    return
  }
  buscaTextoMatches.forEach(el => el.classList.remove('active'))
  buscaTextoIndiceAtivo = ((index % buscaTextoMatches.length) + buscaTextoMatches.length) % buscaTextoMatches.length
  const mark = buscaTextoMatches[buscaTextoIndiceAtivo]
  mark.classList.add('active')
  if (!deveNavegar) {
    buscaTextoNavegou = false
    atualizarContadorBuscaTexto()
    return
  }
  buscaTextoNavegou = true
  mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const range = document.createRange()
  range.selectNodeContents(mark)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  atualizarContadorBuscaTexto()
}

function executarBuscaTexto(indicePreferido, options) {
  const query = textSearchInput?.value || ''
  limparMarcasBuscaTexto()
  if (!query) {
    atualizarContadorBuscaTexto()
    return
  }
  aplicarMarcasBuscaTexto(query)
  ativarResultadoBuscaTexto(typeof indicePreferido === 'number' ? indicePreferido : 0, options)
}

function navegarBuscaTexto(delta) {
  if (!buscaTextoMatches.length) return
  if (!buscaTextoNavegou) {
    ativarResultadoBuscaTexto(buscaTextoIndiceAtivo >= 0 ? buscaTextoIndiceAtivo : 0)
    return
  }
  ativarResultadoBuscaTexto(buscaTextoIndiceAtivo + delta)
}

function stripMarks() {
  limparMarcasBuscaTexto()
  editor.querySelectorAll('span.ref-mark').forEach(mark => {
    mark.replaceWith(...Array.from(mark.childNodes))
  })
  editor.querySelectorAll('span.manual-comment-mark').forEach(mark => {
    mark.replaceWith(...Array.from(mark.childNodes))
  })
  editor.querySelectorAll('.refs-heading').forEach(el => el.classList.remove('refs-heading'))
  editor.querySelectorAll('.ref-format').forEach(el => {
    el.classList.remove('ref-format', 'active')
    delete el.dataset.occurrenceId
    el.removeAttribute('title')
  })
  editor.querySelectorAll('.ref-list-entry').forEach(el => {
    el.classList.remove('ref-list-entry', 'active')
    delete el.dataset.refIndex
  })
  editor.normalize()
  occurrences = []
  activeOccurrenceId = null
  ultimoResultado = null
  urlValidationState = {}
  urlValidationRunning = false
  renderFilters()
  renderOccurrences()
  renderReferencesPanel([])
  renderSummary(null)
}

function atualizarEstadoExportacao() {
  if (!exportCorrectedBtn) return
  const pronto = !!importedDocxArrayBuffer && (correcoesAplicadas.length > 0 || comentariosAplicados.length > 0)
  exportCorrectedBtn.disabled = !pronto
  exportCorrectedBtn.title = pronto
    ? 'Baixar uma cópia do DOCX com as correções e comentários validados.'
    : 'Importe um DOCX e valide ao menos uma correção ou comentário para habilitar.'
}

function limparCorrecoesAplicadas() {
  correcoesAplicadas = []
  comentariosAplicados = []
  window.refsCorrecoesAplicadas = correcoesAplicadas
  window.refsComentariosAplicados = comentariosAplicados
  atualizarEstadoExportacao()
}

function encontrarSecaoReferencias() {
  const blocks = blocosTexto()
  const candidatos = blocks
    .map((el, index) => ({ el, index }))
    .filter(item => pareceTituloSecaoReferencias(item.el))
  const valido = candidatos.find(item => proximoBlocoPareceReferencia(blocks, item.index))
  const fallback = candidatos.length === 1 && candidatos[0].index > blocks.length * 0.5
    ? candidatos[0]
    : null
  const headingIndex = (valido || fallback)?.index ?? -1
  return {
    blocks,
    headingIndex,
    bodyBlocks: headingIndex >= 0 ? blocks.slice(0, headingIndex) : blocks,
    referenceBlocks: headingIndex >= 0 ? blocks.slice(headingIndex + 1) : [],
    heading: headingIndex >= 0 ? blocks[headingIndex] : null,
  }
}

function encontrarSecoesReferenciasElegiveis() {
  const blocks = blocosTexto()
  return blocks
    .map((el, index) => ({ el, index }))
    .filter(item => pareceTituloSecaoReferencias(item.el) && proximoBlocoPareceReferencia(blocks, item.index))
}

function proximoBlocoPareceReferencia(blocks, headingIndex) {
  for (let i = headingIndex + 1; i < blocks.length; i += 1) {
    const text = textoBloco(blocks[i])
    if (!text) continue
    const normal = normalizarTexto(text)
    if (/^(TABLE OF CONTENTS?|SUMARIO|SUMÁRIO|INTRODUCTION|INTRODUCAO|INTRODUÇÃO)$/.test(normal)) return false
    return pareceInicioReferencia(text)
  }
  return false
}

function pareceTituloSecaoReferencias(el) {
  const text = normalizarTexto(textoBloco(el))
    .replace(/^\d+(?:\s+\d+|\.\d+)*\s+/, '')
  return /^(REFERENCIAS|REFER NCIAS|REFERENCIAS BIBLIOGRAFICAS|REFER NCIAS BIBLIOGRAFICAS|BIBLIOGRAFIA|REFERENCES)$/.test(text)
}

function pareceInicioReferencia(text) {
  const t = String(text || '').trim()
  if (!t) return false
  if (autoriaSubstituidaPorLinha(t)) return true
  if (/^[A-ZÀ-Þ][A-ZÀ-Þ\s.'’-]+,\s+[A-ZÀ-Þ]/.test(t)) return true
  if (/^[A-ZÀ-Þ][A-ZÀ-Þ\s.'’-]{2,}\.\s+/.test(t)) return true
  if (/^[A-ZÀ-Þ][A-ZÀ-Þ0-9\s.'’()&-]{2,}\.\s+/.test(t)) return true
  if (/^[A-ZÀ-Þ][A-Za-zÀ-ÿ.'’-]+,\s+[A-ZÀ-Þ]/.test(t)) return true

  const institucional = t.match(/^([A-ZÀ-Þ][A-Za-zÀ-ÿ0-9\s'’()&-]{2,80})\.\s+(.+)/)
  if (institucional) {
    const autor = normalizarEspacos(institucional[1])
    const resto = institucional[2]
    const palavras = autor.split(/\s+/).filter(Boolean)
    const termoProibido = /^(Disponível|Disponivel|Acesso|In|Revista|Editora|Tese|Dissertação|Dissertacao|Doutorado|Mestrado)\b/i
    if (
      palavras.length <= 8
      && !/[,:;]/.test(autor)
      && !termoProibido.test(autor)
      && /(?:\b(?:19|20)\d{2}[a-z]?\b|Dispon[ií]vel\s+em|Acesso\s+em)/i.test(resto)
    ) {
      return true
    }
  }

  return false
}

function autoriaSubstituidaPorLinha(text) {
  return /^_{3,}\.?\s+/.test(String(text || '').trim())
}

function extrairAutoriaOriginalAbnt(refOrText) {
  const text = typeof refOrText === 'object' && refOrText ? refOrText.text : refOrText
  const t = normalizarEspacos(text)
  const autoresSeparados = t.match(/^([^.;]+,\s+[^;.]+(?:;\s+[^.;]+,\s+[^;.]+)+)\.\s+/)
  if (autoresSeparados) return autoresSeparados[1].trim()

  const sobrenome = "[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*"
  const autorComIniciais = `${sobrenome},\\s+(?:[A-Z]\\.\\s*)+`
  const autorComEtAl = `${sobrenome},\\s+[^.;]+?\\s+et\\s+al\\.`
  const autorComEtAlAposPontoEVirgula = `${sobrenome},\\s+[^.;]+;\\s+et\\s+al\\.`
  const autorComNome = `${sobrenome},\\s+[^.;]+\\.`
  const autor = `(?:${autorComEtAlAposPontoEVirgula}|${autorComEtAl}|${autorComIniciais}|${autorComNome})`
  const pessoais = t.match(new RegExp(`^(${autor}(?:\\s*;\\s*${autor})*)\\s+`, 'i'))
  if (pessoais) return pessoais[1].replace(/\.\s*$/, '').trim()

  if (typeof refOrText === 'object' && refOrText && normalizarEspacos(refOrText.autoriaAntesDoNegrito || '')) {
    return normalizarEspacos(refOrText.autoriaAntesDoNegrito || '').replace(/\.\s*$/, '').trim()
  }

  const partes = t.split('.').map(parte => parte.trim()).filter(Boolean)
  if (!partes.length || partes[0].includes(',')) return ''
  if (normalizarTexto(partes[0]) === 'BRASIL' && partes.length >= 3) {
    const segundaTerceira = normalizarTexto(`${partes[1]}. ${partes[2]}`)
    if (/\b(MINISTERIO|SECRETARIA|CONSELHO|AGENCIA|INSTITUTO|FUNDACAO|UNIVERSIDADE)\b/.test(segundaTerceira)) {
      return partes.slice(0, 3).join('. ').trim()
    }
  }
  return partes[0].trim()
}

function textoAntesDoPrimeiroNegrito(root) {
  if (!root) return ''
  let texto = ''
  let encontrouNegrito = false

  function visitar(node) {
    if (!node || encontrouNegrito) return
    if (node.nodeType === 3) {
      texto += node.nodeValue || ''
      return
    }
    if (node.nodeType !== 1) return
    const tag = node.tagName ? node.tagName.toLowerCase() : ''
    if (tag === 'strong' || tag === 'b') {
      encontrouNegrito = true
      return
    }
    Array.from(node.childNodes || []).forEach(visitar)
  }

  visitar(root)
  if (!encontrouNegrito) return ''
  return normalizarEspacos(texto).replace(/[.;\s]+$/g, '')
}

function trechosNegrito(root) {
  const trechos = []

  function visitar(node) {
    if (!node) return
    if (node.nodeType !== 1) return
    const tag = node.tagName ? node.tagName.toLowerCase() : ''
    if (tag === 'strong' || tag === 'b') {
      const text = normalizarEspacos(node.textContent || '')
      if (text) trechos.push(text)
      return
    }
    Array.from(node.childNodes || []).forEach(visitar)
  }

  visitar(root)
  return trechos
}

function trechosItalico(root) {
  const trechos = []

  function visitar(node) {
    if (!node) return
    if (node.nodeType !== 1) return
    const tag = node.tagName ? node.tagName.toLowerCase() : ''
    if (tag === 'em' || tag === 'i') {
      const text = normalizarEspacos(node.textContent || '')
      if (text) trechos.push(text)
      return
    }
    Array.from(node.childNodes || []).forEach(visitar)
  }

  visitar(root)
  return trechos
}

function ehBlocoNotaMammoth(el) {
  if (!el) return false
  if (el.closest?.('[id*="footnote"], [id*="endnote"]')) return true
  if (el.querySelector?.('a[href*="footnote-ref"], a[href*="endnote-ref"]')) return true
  const text = textoBloco(el)
  return /↑\s*$/.test(text) && !!el.closest?.('ol')
}

function montarReferencias(referenceBlocks) {
  const refs = []
  for (const block of referenceBlocks) {
    if (ehBlocoNotaMammoth(block)) break
    const text = textoBloco(block)
    if (!text) continue
    if (!refs.length || pareceInicioReferencia(text)) {
      refs.push({
        text,
        element: block,
        autoriaAntesDoNegrito: textoAntesDoPrimeiroNegrito(block),
        negritos: trechosNegrito(block),
        italicos: trechosItalico(block),
      })
    } else {
      refs[refs.length - 1].text += ` ${text}`
      refs[refs.length - 1].negritos = refs[refs.length - 1].negritos.concat(trechosNegrito(block))
      refs[refs.length - 1].italicos = refs[refs.length - 1].italicos.concat(trechosItalico(block))
    }
  }
  let ultimaAutoriaExplicita = ''
  let ultimaAutoriaOriginalExplicita = ''
  let sequenciaAutoriaSubstituida = 0
  return refs.map((ref, index) => {
    const anos = Array.from(new Set((ref.text.match(YEAR_GLOBAL_RE) || []).map(ano => ano.toLowerCase())))
    const ano = anos[0] || ''
    const autoriaExtraida = extrairAutoriaChaveAbnt(ref)
    const autoriaOriginalExtraida = extrairAutoriaOriginalAbnt(ref)
    const usaAutoriaSubstituida = autoriaSubstituidaPorLinha(ref.text)
    const autoriaBusca = autoriaSubstituidaPorLinha(ref.text)
      ? ultimaAutoriaExplicita
      : autoriaExtraida
    const autoriaSubstituta = autoriaSubstituidaPorLinha(ref.text)
      ? ultimaAutoriaOriginalExplicita
      : ''
    const autoriaGrupoCorrecao = usaAutoriaSubstituida && ultimaAutoriaOriginalExplicita
      ? `autoria-${sequenciaAutoriaSubstituida}`
      : ''
    if (autoriaExtraida && !autoriaSubstituidaPorLinha(ref.text)) {
      sequenciaAutoriaSubstituida += 1
      ultimaAutoriaExplicita = autoriaExtraida
      ultimaAutoriaOriginalExplicita = autoriaOriginalExtraida
    }
    const normal = normalizarTexto(autoriaBusca ? `${autoriaBusca} ${ref.text}` : ref.text)
    return {
      ...ref,
      index,
      ano,
      anos,
      normal,
      autoriaBusca,
      autoriaSubstituta,
      autoriaGrupoCorrecao,
      inicioNormal: autoriaBusca && autoriaSubstituidaPorLinha(ref.text)
        ? autoriaBusca
        : normalizarTexto(ref.text.split('.')[0] || ref.text),
    }
  })
}

function normalizarQuebrasSoltas() {
  const blocks = blocosTexto()
  if (blocks.length !== 1) return
  const text = editor.innerText || editor.textContent || ''
  if (!/\n{2,}/.test(text)) return
  editor.innerHTML = normalizarParagrafoHtml(text)
}

function limparAutoria(raw) {
  return String(raw || '')
    .replace(/\bet\s+al\.?/gi, '')
    .replace(/\be\s+colaboradores?\b/gi, '')
    .replace(/\be\s+colaboradoras?\b/gi, '')
    .replace(/\be\s+cols?\.?/gi, '')
    .replace(/\b(?:apud|cf|ver|vide)\b\.?/gi, '')
    .replace(/\b(?:p|pp)\.\s*[\d–—-]+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,;\s]+|[,;\s]+$/g, '')
}

function autoresDaCitacao(raw) {
  const autoria = limparAutoria(raw)
  const temEtAl = /\bet\s+al\.?|\be\s+colaboradores?\b|\be\s+colaboradoras?\b|\be\s+cols?\.?/i.test(raw)
  const normal = normalizarTexto(autoria)
  if (!normal) return []

  if (temEtAl) {
    return [normal].filter(Boolean)
  }

  const partes = autoria
    .split(/\s*;\s*|\s*&\s*|\s+(?:e|and)\s+(?=[A-ZÀ-Ý])|\s*,\s*(?=[A-ZÀ-Ý][A-Za-zÀ-ÿ]+(?:\s|$))/i)
    .map(p => normalizarTexto(p))
    .filter(Boolean)

  return partes.length ? partes : [normal]
}

function sobrenomeChaveAutorNormalizado(author) {
  const variantes = variantesAutorCitacao(author)
  const candidato = variantes.length > 1 ? variantes[1] : variantes[0]
  const words = candidato.split(/\s+/).filter(Boolean)
  if (words.length >= 2 && AGNOMES_AUTOR.includes(words[1])) return `${words[0]} ${words[1]}`
  return words[0] || candidato
}

function sobrenomesCitacao(unit) {
  return (unit?.authors || [])
    .map(author => sobrenomeChaveAutorNormalizado(author))
    .filter(Boolean)
}

function sobrenomesReferencia(ref) {
  const text = normalizarEspacos(ref?.text || '')
  const autores = []
  const autorRe = /(?:^|;\s*)([A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*),\s+[^.;]+/g
  let match
  while ((match = autorRe.exec(text))) {
    autores.push(normalizarTexto(match[1]))
  }
  return autores
}

function problemasEspacoIndicadores(text) {
  const t = String(text || '')
  const issues = []
  if (/\bp\.\d/i.test(t)) issues.push('Insira espaço entre "p." e o número da página.')
  if (/\bv\.\d/i.test(t)) issues.push('Insira espaço entre "v." e o número do volume.')
  if (/\bn\.\d/i.test(t)) issues.push('Insira espaço entre "n." e o número.')
  if (/\bp\.\s*\d{4,}(?![\d.])/i.test(t)) {
    issues.push('Número de página com milhar deve usar ponto: "p. 2.140".')
  }
  return issues
}

function capitalizarNomeCitacao(text) {
  return normalizarEspacos(text)
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, prefixo, letra) => prefixo + letra.toLocaleUpperCase('pt-BR'))
    .replace(/\bEt\s+Al\.?/gi, 'et al.')
}

function autoriaCitacaoTemSeparadorInadequado(text) {
  return /\s+(?:e|and)\s+/i.test(text || '') || /&/.test(text || '')
}

function corrigirAutoriaCitacao(text) {
  const autoria = normalizarEspacos(text)
  if (!autoria) return autoria
  if (/\bet\s+al\.?|\be\s+colaboradores?\b|\be\s+colaboradoras?\b|\be\s+cols?\.?/i.test(autoria)) {
    return capitalizarNomeCitacao(autoria)
  }

  const partes = autoria
    .split(/\s*;\s*|\s*&\s*|\s+(?:e|and)\s+(?=[A-ZÀ-Ý])|\s*,\s*(?=[A-ZÀ-Ý][A-Za-zÀ-ÿ]+(?:\s|$))/i)
    .map(parte => normalizarEspacos(parte))
    .filter(Boolean)

  if (partes.length > 1) return partes.map(capitalizarNomeCitacao).join('; ')
  return capitalizarNomeCitacao(autoria)
}

function autoriaCitacaoEmCaixaAlta(text) {
  const autoria = normalizarEspacos(text)
    .replace(/\bet\s+al\.?/gi, '')
    .replace(/\b(?:apud|cf|ver|vide)\b\.?/gi, '')
    .replace(/[(),.;:]/g, ' ')
    .trim()
  const letras = autoria.replace(/[^\p{L}]/gu, '')
  if (letras.length < 3) return false
  return !/[a-zà-ÿ]/.test(autoria) && /[A-ZÀ-Ý]{3,}/.test(autoria)
}

function referenciaParecePessoaFisica(ref) {
  const text = normalizarEspacos(ref?.text || '')
  if (!text) return false
  const autorPessoa = /^[\p{Lu}][\p{Lu}\p{M}'’.-]+(?:\s+[\p{Lu}][\p{Lu}\p{M}'’.-]+)*,\s+[^.;]{1,90}(?:\.|;)/u
  return autorPessoa.test(text)
}

function problemaCaixaAltaAutorCitacao(unit, ref) {
  if (!referenciaParecePessoaFisica(ref)) return ''
  if (!autoriaCitacaoEmCaixaAlta(unit?.authorsRaw || '')) return ''
  const sugestao = corrigirAutoriaCitacao(unit.authorsRaw || '')
  return `Em citações de pessoa física, não use caixa alta no sobrenome do autor; prefira "${sugestao}" em vez de "${normalizarEspacos(unit.authorsRaw)}".`
}

function problemasAutoresCitacao(unit, ref) {
  const issues = []
  const autores = sobrenomesCitacao(unit)
  if (!unit?.narrativa && autores.length > 1 && autoriaCitacaoTemSeparadorInadequado(unit?.authorsRaw || '')) {
    issues.push('Em citações parentéticas com dois ou mais autores, separe os autores por ponto e vírgula, não por "e", "and" ou "&".')
  }

  if (!ref || autores.length < 2) return issues
  const autoresRef = sobrenomesReferencia(ref)
  if (autoresRef.length < autores.length) return issues

  const mesmosAutores = autores.every(autor => autoresRef.includes(autor))
  const mesmaOrdem = autores.every((autor, index) => autoresRef[index] === autor)
  if (mesmosAutores && !mesmaOrdem) {
    issues.push(`A ordem dos autores na citação diverge da lista de referências; prefira "${autoresRef.slice(0, autores.length).join('; ')}".`)
  }
  return issues
}

function palavrasNormalizadas(text) {
  return normalizarTexto(text).split(/\s+/).filter(Boolean)
}

function distanciaEdicaoLimitada(a, b, limite) {
  const left = String(a || '')
  const right = String(b || '')
  if (Math.abs(left.length - right.length) > limite) return limite + 1
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    let menorLinha = current[0]
    for (let j = 1; j <= right.length; j += 1) {
      const custo = left[i - 1] === right[j - 1] ? 0 : 1
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + custo,
      )
      menorLinha = Math.min(menorLinha, current[j])
    }
    if (menorLinha > limite) return limite + 1
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j]
  }
  return previous[right.length]
}

function contemPalavraSimilarNormalizada(text, word, limite = 1) {
  const alvo = normalizarTexto(word)
  if (alvo.length < 4) return false
  return palavrasNormalizadas(text)
    .some(candidate => candidate.length >= 4
      && candidate[0] === alvo[0]
      && distanciaEdicaoLimitada(candidate, alvo, limite) <= limite)
}

function problemaNomeSimilarAutorCitacao(unit, ref) {
  if (!ref) return ''
  for (const author of unit?.authors || []) {
    const words = author.split(/\s+/).filter(w => w.length > 1)
    if (words.length < 2) continue

    const variantes = variantesAutorCitacao(author)
    const coincidenciaIntegral = variantes.some(variant => (
      contemTermoNormalizado(ref.normal, variant)
      || (ref.inicioNormal && contemTermoNormalizado(ref.inicioNormal, variant))
    ))
    if (coincidenciaIntegral) continue

    const sobrenome = sobrenomePrincipalAutor(author)
    const sobrenomeInicioHit = sobrenome && ref.inicioNormal && contemTermoNormalizado(ref.inicioNormal, sobrenome)
    const nomesDistintivos = words
      .filter(w => w.length >= 4)
      .filter(w => !sobrenome.split(/\s+/).includes(w))
    const nomeDistintivoHit = nomesDistintivos.some(w => contemTermoNormalizado(ref.normal, w))
    const nomeSimilarHit = nomesDistintivos.some(w => contemPalavraSimilarNormalizada(ref.normal, w))

    if (sobrenomeInicioHit && (nomeDistintivoHit || nomeSimilarHit)) {
      return nomeSimilarHit && !nomeDistintivoHit
        ? 'O nome do autor na citação está quase igual ao nome da lista de referências; confira possível erro de grafia.'
        : 'O nome do autor na citação está apenas similar ao nome na lista de referências; confira se há omissão ou variação de prenome/nome intermediário.'
    }
  }
  return ''
}

function ehParenteseNaoBibliografico(text) {
  const cleaned = String(text || '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^\d{4}\s*[-\u2013\u2014]\s*\d{4}$/.test(cleaned)) return true
  if (/^\d{4}\s*[-\u2013\u2014]\s*(?:\d{4}|atualidade|presente|atual)\b(?:\s*;\s*\d{4}\s*[-\u2013\u2014]\s*(?:\d{4}|atualidade|presente|atual)\b)+$/i.test(cleaned)) {
    return true
  }
  if (/^\d{4}\s*[-\u2013\u2014]\s*\d{4}\b(?:\s+(?:no|na|nos|nas|em|de|do|da|dos|das)\b[^;,.]*)?(?:\s+e\s+\d{4}\s*[-\u2013\u2014]\s*\d{4}\b(?:\s+(?:no|na|nos|nas|em|de|do|da|dos|das)\b[^;,.]*)?)*$/i.test(cleaned)) {
    return true
  }

  const legalText = cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  if (/\/\s*(?:19|20)\d{2}\b/.test(legalText)) return true
  if (/^(?:lei|leis|lei complementar|decreto|decreto lei|medida provisoria|emenda constitucional|resolucao)\b.*\b\d{1,5}(?:[\.\s]?\d{3})*\/(?:19|20)\d{2}\b/.test(legalText)) {
    return true
  }

  return false
}

function extrairUnidadesCitacao(text) {
  if (ehParenteseNaoBibliografico(text)) return []
  const cleaned = String(text || '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (/\bapud\b/i.test(cleaned)) {
    const partesApud = cleaned.split(/\bapud\b/i)
    const fonteConsultada = partesApud[partesApud.length - 1]
    return extrairUnidadesCitacao(fonteConsultada).map(unit => ({
      ...unit,
      raw: `apud ${unit.raw}`.replace(/\s+/g, ' ').trim(),
      apud: true,
    }))
  }
  const units = []
  let cursor = 0
  let lastAuthorsRaw = ''
  let match
  YEAR_GLOBAL_RE.lastIndex = 0
  while ((match = YEAR_GLOBAL_RE.exec(cleaned))) {
    const rawAuthors = cleaned.slice(cursor, match.index).replace(/^[;\s]+/, '').replace(/[,;\s]+$/, '')
    const authorsRaw = rawAuthors || lastAuthorsRaw
    const ano = match[0].toLowerCase()
    const after = cleaned.slice(match.index + match[0].length)
    const pagina = (after.match(/^\s*,?\s*p\.?\s*[\d–—-]+(?:\s*-\s*\d+)?/i) || [''])[0]
    if (authorsRaw && !/^\d+$/.test(authorsRaw) && !/(?:^|[\s,;])de$/i.test(authorsRaw)) {
      units.push({
        raw: `${authorsRaw}, ${ano}${pagina}`.replace(/\s+/g, ' ').trim(),
        authorsRaw,
        authors: autoresDaCitacao(authorsRaw),
        ano,
      })
      if (rawAuthors) lastAuthorsRaw = rawAuthors
    }
    const separatorMatch = after.match(/^\s*;\s*/)
    cursor = separatorMatch
      ? match.index + match[0].length + separatorMatch[0].length
      : match.index + match[0].length
  }
  return units
}

function ehCitacaoAnoPaginaSemAutor(text) {
  return /^\s*(?:19|20)\d{2}[a-z]?\s*,\s*p\.?\s*\d+(?:\s*[-–—]\s*\d+)?(?:\s*,\s*[^;()]+)?\s*\.?\s*$/i
    .test(String(text || ''))
}

function normalizarCitacoesInlineNosBlocos(blocks) {
  blocks.forEach(block => {
    block.querySelectorAll?.('em, i').forEach(el => {
      const text = normalizarEspacos(el.textContent || '')
      if (/^et\s+al\.?$/i.test(text)) {
        el.replaceWith(document.createTextNode(el.textContent || ''))
      }
    })
    block.normalize()
  })
}

function encontrarAutorAntes(text, start) {
  const before = text.slice(0, start)
  const nomeAutor = "[A-ZÀ-Ý][A-Za-zÀ-ÿ.'’-]+(?:\\s+(?:de|da|do|das|dos|Jr\\.?|Junior|Filho|Neto|Sobrinho|[A-ZÀ-Ý][A-Za-zÀ-ÿ.'’-]+)){0,8}"
  const sufixoColetivo = "(?:\\s+et\\s+al\\.?|\\s+e\\s+colaboradores?|\\s+e\\s+colaboradoras?|\\s+e\\s+cols?\\.?)?"
  const autoriaRe = new RegExp("(?:^|[\\s,.;:])(" + nomeAutor + "(?:(?:\\s*,\\s*|\\s*;\\s*|\\s+(?:e|and)\\s+|\\s*&\\s*)" + nomeAutor + ")*" + sufixoColetivo + ")\\s*$")
  const match = before.match(autoriaRe)
  if (!match) return null
  const original = match[1].trim()
  let author = original
    .replace(/^(?:Segundo|Para|Conforme|Consoante|Cf\.?|Ver|Vide|Apud)\s+/i, '')
    .trim()
  const contextoCurto = author.match(/(?:^|\s)(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ.'’-]{0,2}|[A-ZÀ-Ý]{1,4}s?)\s+(?:de|da|do|das|dos)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ.'’-]+(?:\s+(?:Jr\.?|Junior|Filho|Neto|Sobrinho))?)$/)
  if (contextoCurto) author = contextoCurto[1].trim()
  const deslocamento = original.lastIndexOf(author)
  const authorStart = start - original.length + Math.max(0, deslocamento) - (before.slice(-1) === ' ' ? 1 : 0)
  return {
    text: author,
    start: Math.max(0, authorStart + (before.slice(authorStart, authorStart + 1) === ' ' ? 1 : 0)),
  }
}

function temIndicadorCitacaoAntes(text, authorStart) {
  const contexto = text.slice(Math.max(0, authorStart - 80), authorStart)
  return /(?:^|[\s,.;:])(?:segundo|conforme|consoante|para|apud|cf\.?|ver|vide|destaca|afirma|afirmam|aponta|apontam|observa|observam|sustenta|sustentam|defende|defendem|explica|explicam|assinala|assinalam|ressalta|ressaltam|a pesquisadora|o pesquisador|a autora|o autor|as autoras|os autores|de acordo com)\s+$/i
    .test(contexto)
}

function temIndicadorCitacaoDepois(text, end) {
  const contexto = text.slice(end, end + 100)
  return /^\s*,?\s*(?:conforme\s+)?citado\s+por\b/i.test(contexto)
    || /^\s*,?\s*apud\b/i.test(contexto)
}

function autorAnoExisteNaLista(authorText, ano, referencias) {
  if (!authorText || !ano) return false
  const unit = {
    authorsRaw: authorText,
    authors: autoresDaCitacao(authorText),
    ano: String(ano).toLowerCase(),
  }
  return referencias.some(ref => scoreReferencia(unit, ref, true) > 0)
}

function autorExisteNaLista(authorText, referencias) {
  if (!authorText) return false
  const unit = {
    authorsRaw: authorText,
    authors: autoresDaCitacao(authorText),
    ano: '',
  }
  return referencias.some(ref => scoreReferencia(unit, ref, false) > 0)
}

function palavrasDistintivasAutor(authorText) {
  return normalizarTexto(authorText)
    .split(/\s+/)
    .filter(word => word.length >= 4)
    .filter(word => !['PARA', 'CONFORME', 'CONSOANTE', 'SEGUNDO', 'APUD', 'CITADO', 'CITADA'].includes(word))
}

function tokensAutoriaComIndice(text) {
  const tokens = []
  String(text || '').replace(/\S+/g, (token, index) => {
    tokens.push({ token, index })
    return token
  })
  return tokens
}

function melhorAutorNarrativo(autorAntes, ano, referencias) {
  if (!autorAntes?.text) return autorAntes
  const tokens = tokensAutoriaComIndice(autorAntes.text)
  const candidatos = tokens
    .filter(item => /^[A-ZÀ-Ý]/.test(item.token))
    .map(item => ({
      text: autorAntes.text.slice(item.index).trim(),
      start: autorAntes.start + item.index,
    }))
    .filter(item => item.text)

  let melhor = null
  candidatos.forEach(candidato => {
    const unit = {
      authorsRaw: candidato.text,
      authors: autoresDaCitacao(candidato.text),
      ano: String(ano || '').toLowerCase(),
    }
    const refScore = referencias
      .map(ref => ({ ref, score: scoreReferencia(unit, ref, true) || scoreReferencia(unit, ref, false) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]
    if (!refScore) return

    const missingWords = palavrasDistintivasAutor(candidato.text)
      .filter(word => !contemTermoNormalizado(refScore.ref.normal, word)
        && !contemPalavraSimilarNormalizada(refScore.ref.normal, word))
      .length
    const wordCount = normalizarTexto(candidato.text).split(/\s+/).filter(Boolean).length
    const rank = {
      missingWords,
      score: refScore.score,
      wordCount,
      start: candidato.start,
    }
    if (!melhor
      || rank.missingWords < melhor.rank.missingWords
      || (rank.missingWords === melhor.rank.missingWords && rank.score > melhor.rank.score)
      || (rank.missingWords === melhor.rank.missingWords && rank.score === melhor.rank.score && rank.wordCount > melhor.rank.wordCount)
      || (rank.missingWords === melhor.rank.missingWords && rank.score === melhor.rank.score && rank.wordCount === melhor.rank.wordCount && rank.start > melhor.rank.start)) {
      melhor = { ...candidato, rank }
    }
  })

  return melhor ? { text: melhor.text, start: melhor.start } : autorAntes
}

function nodeEstaEmItalico(node) {
  return !!node?.parentElement?.closest('em, i')
}

function textNodesInside(root, limiteSet) {
  const nodes = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      if (node.parentElement?.closest('.ref-mark')) return NodeFilter.FILTER_REJECT
      const block = node.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6')
      if (!block || !limiteSet.has(block)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let node
  while ((node = walker.nextNode())) nodes.push(node)
  return nodes
}

function coletarCitacoes(bodyBlocks, referencias) {
  const matches = []
  normalizarCitacoesInlineNosBlocos(bodyBlocks)
  const limiteSet = new Set(bodyBlocks)
  const nodes = textNodesInside(editor, limiteSet)

  for (const node of nodes) {
    const text = node.nodeValue
    const regex = /\(([^()\n]{0,220}(?:19|20)\d{2}[a-z]?(?:[^()\n]{0,120})?)\)/gi
    let match
    while ((match = regex.exec(text))) {
      const inside = match[1]
      if (ehParenteseNaoBibliografico(inside)) continue
      if (/^\s*\d{4}\s*[-–—]\s*\d{4}\s*$/.test(inside)) continue
      const issues = problemasEspacoIndicadores(inside)
      if (/\bapud\b/i.test(inside) && !nodeEstaEmItalico(node)) {
        issues.push('A expressão <i>apud</i> deve estar em itálico.')
      }
      let units = extrairUnidadesCitacao(inside)
      let start = match.index
      let display = match[0]

      if (!units.length && ehCitacaoAnoPaginaSemAutor(inside)) {
        const ano = (inside.match(YEAR_RE) || [''])[0].toLowerCase()
        units = [{
          raw: normalizarEspacos(inside),
          authorsRaw: '',
          authors: [],
          ano,
          autorAusente: true,
        }]
        issues.push('Citação com ano e página sem indicação de autor. Informe a autoria ou confira se a referência deve ser vinculada pelo contexto.')
      }

      if (units.length <= 1 && /^[,;\s]*(?:19|20)\d{2}/i.test(inside)) {
        const autorAntes = encontrarAutorAntes(text, match.index)
        const ano = (inside.match(YEAR_RE) || [''])[0].toLowerCase()
        const autorNarrativo = melhorAutorNarrativo(autorAntes, ano, referencias)
        const aceitarAutorAntes = autorNarrativo?.text && (
          temIndicadorCitacaoAntes(text, autorNarrativo.start)
          || temIndicadorCitacaoDepois(text, regex.lastIndex)
          || autorAnoExisteNaLista(autorNarrativo.text, ano, referencias)
          || autorExisteNaLista(autorNarrativo.text, referencias)
        )
        if (aceitarAutorAntes) {
          units = [{
            raw: `${autorNarrativo.text} (${inside})`,
            authorsRaw: autorNarrativo.text,
            authors: autoresDaCitacao(autorNarrativo.text),
            ano,
            narrativa: true,
          }]
          start = autorNarrativo.start
          display = text.slice(start, regex.lastIndex)
        }
      }

      if (!units.length) continue
      matches.push({
        node,
        start,
        end: regex.lastIndex,
        text: display,
        units,
        issues,
      })
    }
  }

  return matches.sort((a, b) => {
    if (a.node === b.node) return b.start - a.start || b.end - a.end
    return 0
  })
}

function variantesAutorCitacao(author) {
  const normal = normalizarTexto(author)
  const words = normal.split(/\s+/).filter(Boolean)
  const variantes = [normal].concat(variantesInstitucionaisAutor(author))
  const ultimo = words[words.length - 1]
  if (words.length >= 2) {
    if (AGNOMES_AUTOR.includes(ultimo)) {
      const sobrenomeComAgnome = `${words[words.length - 2]} ${ultimo}`
      variantes.push(sobrenomeComAgnome)
      variantes.push(`${sobrenomeComAgnome} ${words.slice(0, -2).join(' ')}`.trim())
    } else {
      variantes.push(`${ultimo} ${words.slice(0, -1).join(' ')}`.trim())
    }
  }
  return Array.from(new Set(variantes))
}

function contemTermoNormalizado(text, term) {
  const t = ` ${normalizarTexto(text)} `
  const normalizedTerm = normalizarTexto(term)
  if (!normalizedTerm) return false
  return t.includes(` ${normalizedTerm} `)
}

function sobrenomePrincipalAutor(author) {
  const words = normalizarTexto(author).split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  const ultimo = words[words.length - 1]
  if (AGNOMES_AUTOR.includes(ultimo) && words.length >= 2) {
    return `${words[words.length - 2]} ${ultimo}`
  }
  return ultimo
}

function detalharScoreReferencia(unit, ref, exigirAno) {
  const anoOk = unit.ano && ((ref.anos || []).includes(unit.ano) || ref.ano === unit.ano)
  if (exigirAno && !anoOk) {
    return { score: 0, hits: 0, autoresComHit: 0, totalAutores: (unit.authors || []).length, anoOk }
  }

  const autores = unit.authors || []
  if (!autores.length) return { score: 0, hits: 0, autoresComHit: 0, totalAutores: 0, anoOk }

  let hits = 0
  let autoresComHit = 0
  for (const author of autores) {
    const words = author.split(/\s+/).filter(w => w.length > 1)
    if (!words.length) continue
    const variantes = variantesAutorCitacao(author)
    const phraseHit = variantes.some(variant => contemTermoNormalizado(ref.normal, variant))
    const inicioHit = ref.inicioNormal && variantes.some(variant => contemTermoNormalizado(ref.inicioNormal, variant))
    const varianteInicioHit = variantes.length > 1 && ref.inicioNormal && variantes.slice(1).some(variant => contemTermoNormalizado(ref.inicioNormal, variant))
    const sobrenome = sobrenomePrincipalAutor(author)
    const sobrenomeInicioHit = sobrenome && ref.inicioNormal && contemTermoNormalizado(ref.inicioNormal, sobrenome)
    const palavrasDistintivas = words.filter(w => w.length >= 4)
    const nomesDistintivos = palavrasDistintivas.filter(w => !sobrenome.split(/\s+/).includes(w))
    const nomeDistintivoHit = nomesDistintivos.some(w => contemTermoNormalizado(ref.normal, w))
    const nomeSimilarHit = nomesDistintivos.some(w => contemPalavraSimilarNormalizada(ref.normal, w))
    const autoriaComposta = words.length >= 3
    if (autoriaComposta && !phraseHit && !varianteInicioHit && !(sobrenomeInicioHit && (nomeDistintivoHit || nomeSimilarHit)) && palavrasDistintivas.some(w => !contemTermoNormalizado(ref.normal, w) && !contemPalavraSimilarNormalizada(ref.normal, w))) continue
    const wordHits = words.filter(w => contemTermoNormalizado(ref.normal, w)).length
    if (phraseHit || inicioHit || varianteInicioHit || (sobrenomeInicioHit && (nomeDistintivoHit || nomeSimilarHit))) {
      hits += inicioHit ? 3 : 2
      autoresComHit += 1
    } else if (!autoriaComposta && wordHits >= Math.min(words.length, 2)) {
      hits += 1
      autoresComHit += 1
    }
  }

  if (!hits) return { score: 0, hits: 0, autoresComHit: 0, totalAutores: autores.length, anoOk }
  return {
    score: (anoOk ? 100 : 45) + hits * 10,
    hits,
    autoresComHit,
    totalAutores: autores.length,
    anoOk,
  }
}

function scoreReferencia(unit, ref, exigirAno) {
  return detalharScoreReferencia(unit, ref, exigirAno).score
}

function vincularUnidade(unit, referencias) {
  if (unit?.autorAusente) return { status: 'authorless', ref: null }

  const comAno = referencias
    .map(ref => ({ ref, ...detalharScoreReferencia(unit, ref, true) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.autoresComHit - a.autoresComHit || b.hits - a.hits)[0]

  const semAno = referencias
    .map(ref => ({ ref, ...detalharScoreReferencia(unit, ref, false) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.autoresComHit - a.autoresComHit || b.hits - a.hits || b.score - a.score)[0]

  if (comAno) {
    const matchComAnoIncompleto = comAno.autoresComHit < comAno.totalAutores
    const semAnoMaisEspecifico = semAno
      && semAno.ref !== comAno.ref
      && (
        semAno.autoresComHit > comAno.autoresComHit
        || (semAno.autoresComHit === comAno.autoresComHit && semAno.hits >= comAno.hits + 2)
      )
    if (matchComAnoIncompleto && semAnoMaisEspecifico) {
      return { status: 'warning', ref: semAno.ref }
    }
    return { status: 'ok', ref: comAno.ref }
  }

  if (semAno) return { status: 'warning', ref: semAno.ref }
  return { status: 'missing', ref: null }
}

function classeResultado(statuses) {
  if (statuses.includes('authorless')) return 'authorless'
  if (statuses.length > 1 && statuses.includes('missing') && statuses.some(status => status !== 'missing')) {
    return 'partial'
  }
  if (statuses.includes('missing')) return 'missing'
  if (statuses.includes('warning')) return 'warning'
  return 'ok'
}

function textoStatus(status) {
  if (status === 'ok') return 'Encontrada'
  if (status === 'authorless') return 'Autor ausente'
  if (status === 'partial') return 'Parcial'
  if (status === 'warning') return 'Ano divergente'
  if (status === 'format') return 'Checagem ABNT'
  return 'Ausente'
}

function classificarReferenciaAbnt(text) {
  const t = normalizarEspacos(text)
  const n = normalizarTexto(t)
  const temOnline = /\bDISPONI?VEL EM\b|\bDISPON\s+VEL EM\b|\bACESSO EM\b/.test(n) || /https?:\/\/|www\./i.test(t)
  const temVolumeOuNumero = /\bv\.\s*\d+[A-Za-z]?/i.test(t) || /\bn\.\s*\d+[A-Za-z]?/i.test(t)
  const temPeriodico = temVolumeOuNumero || /\bp\.\s*\d+/i.test(t)
  const termoJuridico = '(?:Constituição|Lei(?:\\s+Complementar)?|Decreto(?:-Lei)?|Portaria|Resolução|Medida\\s+Provisória|Jurisprudência|Acórdão)'

  if (new RegExp(`^(?:BRASIL|[A-ZÀ-Ý][A-ZÀ-Ý ]{2,})\\.\\s+${termoJuridico}\\b`, 'i').test(t)) return 'legislacao'
  if (new RegExp(`^${termoJuridico}\\b`, 'i').test(t)) return 'legislacao'
  if (/\b(DISSERTACAO|DISSERTAÇÃO|TESE|MONOGRAFIA|TRABALHO DE CONCLUSAO|TRABALHO DE CONCLUSÃO)\b/.test(n)) return 'tese'
  if (/\b(YOUTUBE|VIMEO|VIDEO|VÍDEO|FILME|DOCUMENTARIO|DOCUMENTÁRIO|CANAL|PODCAST)\b/.test(n) || /\b\d+\s*(?:min|h)\b/i.test(t)) return 'audiovisual'
  if (/\bANAIS|CONGRESSO|SEMINARIO|SEMINÁRIO|ENCONTRO|SIMP[OÓ]SIO|CONFER[EÊ]NCIA\b/i.test(t)) return 'evento'
  if (/\bIn:\s/i.test(t) && temVolumeOuNumero) return 'artigoPeriodico'
  if (/\bIn:\s/i.test(t)) return 'capitulo'
  if (/\bv\.\s*\d+[A-Za-z]?/i.test(t) && /\bn\.\s*\d+[A-Za-z]?/i.test(t)) return 'artigoPeriodico'
  if (/\bn\.\s*\d+[A-Za-z]?/i.test(t) && /\bp\.\s*[A-Z]?\d+(?:\s*[-–]\s*[A-Z]?\d+)?/i.test(t)) return 'artigoPeriodico'
  if (temPeriodico && /\b(revista|journal|caderno|cadernos|ci[eê]ncia|sa[uú]de|educa[cç][aã]o|estudos|anais)\b/i.test(t)) return 'artigoPeriodico'
  if (/\b(jornal|folha|estado de|estad[aã]o|gazeta|correio|tribuna)\b/i.test(t)) return 'jornal'
  if (temOnline) return 'site'
  if (/:\s*[^,]+,\s*(?:\[[^\]]+\]|(?:18|19|20)\d{2})/.test(t)) return 'livro'
  return 'desconhecido'
}

function temAutoresSeparadosPorPontoEVirgula(text) {
  const t = normalizarEspacos(text)
  if (/^[^.;]+,\s+[^;.]+(?:;\s+[^.;]+,\s+[^;.]+)+\.\s+/.test(t)) return true
  const autor = "[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\\s+"
  return new RegExp(`^(?:${autor}[^;]+;\\s+)+${autor}.+?\\.\\s+`).test(t)
}

function temAutoriaAbnt(text) {
  const t = normalizarEspacos(text)
  if (/^[A-ZÀ-Ý][A-ZÀ-Ý0-9 .,'’&()/-]{2,}\.\s+/.test(t)) return true
  if (/^[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+[^.;]+(?:\.\s*[A-Z]\.)?\s+et\s+al\.\s+/i.test(t)) return true
  if (/^[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+[^.;]+;\s+et\s+al\.\s+/i.test(t)) return true
  if (temAutoresSeparadosPorPontoEVirgula(t)) return true
  if (/^[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+[^.]+(?:\.\s*[A-Z]\.)?\s*;\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+/.test(t)) return true
  if (/^[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+[^.]{2,}\.\s+/.test(t)) return true
  return false
}

function usaEtAl(text) {
  return /\bet\s+al\.?/i.test(text)
}

function etAlAbntIncorreto(text) {
  const t = normalizarEspacos(text)
  if (!usaEtAl(t)) return false
  return /\bet\s+al(?!\.)/i.test(t)
}

function extrairAutoriaChaveAbnt(refOrText) {
  const text = typeof refOrText === 'object' && refOrText ? refOrText.text : refOrText
  const t = normalizarEspacos(text)
  const autoresSeparados = t.match(/^([^.;]+,\s+[^;.]+(?:;\s+[^.;]+,\s+[^;.]+)+)\.\s+/)
  if (autoresSeparados) return normalizarTexto(autoresSeparados[1])
  const sobrenome = "[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*"
  const autorComIniciais = `${sobrenome},\\s+(?:[A-Z]\\.\\s*)+`
  const autorComEtAl = `${sobrenome},\\s+[^.;]+?\\s+et\\s+al\\.`
  const autorComEtAlAposPontoEVirgula = `${sobrenome},\\s+[^.;]+;\\s+et\\s+al\\.`
  const autorComNome = `${sobrenome},\\s+[^.;]+\\.`
  const autor = `(?:${autorComEtAlAposPontoEVirgula}|${autorComEtAl}|${autorComIniciais}|${autorComNome})`
  const pessoais = t.match(new RegExp(`^(${autor}(?:\\s*;\\s*${autor})*)\\s+`, 'i'))
  if (pessoais) return normalizarTexto(pessoais[1])

  const autoriaNegrito = typeof refOrText === 'object' && refOrText
    ? normalizarTexto(refOrText.autoriaAntesDoNegrito || '')
    : ''
  if (autoriaNegrito) return autoriaNegrito

  const partes = t.split('.').map(parte => parte.trim()).filter(Boolean)
  if (!partes.length) return ''
  const primeira = normalizarTexto(partes[0])
  if (!primeira || primeira.includes(',')) return ''

  if (primeira === 'BRASIL' && partes.length >= 3) {
    const segundaTerceira = normalizarTexto(`${partes[1]}. ${partes[2]}`)
    if (/\b(MINISTERIO|SECRETARIA|CONSELHO|AGENCIA|INSTITUTO|FUNDACAO|UNIVERSIDADE)\b/.test(segundaTerceira)) {
      return normalizarTexto(partes.slice(0, 3).join('. '))
    }
  }

  return primeira
}

function extrairAutoriaAgrupamentoAno(refOrText) {
  const text = typeof refOrText === 'object' && refOrText ? refOrText.text : refOrText
  const t = normalizarEspacos(text)
  const primeiraParte = normalizarTexto(t.split('.')[0] || '')
  if (primeiraParte === 'BRASIL') return 'BRASIL'
  if (primeiraParte && !primeiraParte.includes(',')) return primeiraParte
  return extrairAutoriaChaveAbnt(refOrText)
}

function extrairAnoReferenciaPrincipal(ref) {
  const text = String(ref?.text || '')
  const corteOnline = text.search(/Dispon\S*\s+em:?|Acesso\s+em:?|https?:\/\//i)
  const trechoPrincipal = corteOnline >= 0 ? text.slice(0, corteOnline) : text
  const anos = trechoPrincipal.match(/(?:18|19|20)\d{2}[a-z]?/gi) || text.match(/(?:18|19|20)\d{2}[a-z]?/gi) || []
  return anos.length ? anos[anos.length - 1].toLowerCase() : ''
}

function indiceUltimoAnoPrincipal(text) {
  const valor = String(text || '')
  const corteOnline = valor.search(/Dispon\S*\s+em:?|Acesso\s+em:?|https?:\/\//i)
  const limite = corteOnline >= 0 ? corteOnline : valor.length
  const trechoPrincipal = valor.slice(0, limite)
  const re = /(?:18|19|20)\d{2}[a-z]?/gi
  let match
  let ultimo = null
  while ((match = re.exec(trechoPrincipal))) {
    ultimo = { index: match.index, text: match[0] }
  }
  return ultimo
}

function autoresMultiplosSemPontoEVirgula(text) {
  const t = normalizarEspacos(text)
  if (usaEtAl(t)) return false
  return /^[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+[^.;]+(?:\.\s*[A-Z]\.)?,\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+/.test(t)
}

function contarAutoresExplícitos(text) {
  const t = normalizarEspacos(text)
  if (usaEtAl(t)) return 0
  const match = t.match(/^([^.;]+,\s+[^;.]+(?:;\s+[^.;]+,\s+[^;.]+)+)\.\s+/)
  if (!match) return 0
  return match[1].split(/\s*;\s*/).filter(Boolean).length
}

function negritoPareceFonteSeriada(text, trecho, tipo) {
  const indice = text.indexOf(trecho)
  if (indice < 0) return false
  const depois = text.slice(indice + trecho.length)
  if (tipo === 'artigoPeriodico') {
    return /^,\s*[^,.;]{2,90},\s*(?:v\.|n\.|p\.|(?:18|19|20)\d{2})/i.test(depois)
      || /^,\s*(?:v\.|n\.|p\.)\s*/i.test(depois)
  }
  if (tipo === 'jornal') {
    return /^,\s*(?:[A-ZÀ-ÿ][^,.;]{2,80},\s*)?(?:\d{1,2}\s+|p\.|(?:18|19|20)\d{2})/i.test(depois)
  }
  return false
}

function termoEmItalico(ref, regex) {
  return (ref.italicos || []).some(trecho => regex.test(trecho))
}

function validarItalicosReferencia(ref) {
  const issues = []
  const text = normalizarEspacos(ref.text || '')
  if (/\bet\s+al\.?/i.test(text) && !termoEmItalico(ref, /\bet\s+al\.?/i)) {
    issues.push('A expressão "et al." deve estar em itálico.')
  }
  if (/\bIn:\s/i.test(text) && !termoEmItalico(ref, /^In:?$/i)) {
    issues.push('A expressão "In:" deve estar em itálico.')
  }
  return issues
}

function validarNegritoReferencia(ref, tipo) {
  const issues = []
  const text = normalizarEspacos(ref.text || '')
  const negritos = (ref.negritos || []).map(normalizarEspacos).filter(Boolean)
  const exigeNegrito = ['livro', 'artigoPeriodico', 'jornal', 'tese', 'legislacao'].includes(tipo)
  const rotulos = {
    livro: 'Livro/e-book deve ter o título principal em negrito.',
    artigoPeriodico: 'Artigo de periódico deve ter o nome da revista ou periódico em negrito.',
    jornal: 'Artigo de jornal deve ter o nome do jornal em negrito.',
    tese: 'Trabalho acadêmico deve ter o título principal em negrito.',
    legislacao: 'Documento jurídico deve ter o nome da norma em negrito.',
  }

  if (exigeNegrito && !negritos.length) {
    issues.push(rotulos[tipo])
    return issues
  }

  negritos.forEach(trecho => {
    if (/[,:.;]$/.test(trecho)) {
      issues.push('O negrito não deve incluir sinais de pontuação próximos, como dois-pontos, vírgulas ou pontos finais.')
    }
    if (/:.+/.test(trecho)) {
      issues.push('O subtítulo não deve ficar em negrito; destaque apenas o título principal antes dos dois-pontos.')
    }
  })

  if ((tipo === 'artigoPeriodico' || tipo === 'jornal') && negritos.length) {
    const primeiroNegrito = negritos[0]
    const primeiroNegritoPareceFonte = negritoPareceFonteSeriada(text, primeiroNegrito, tipo)
    const antesDoPrimeiroNegrito = normalizarEspacos(ref.autoriaAntesDoNegrito || '')
    const textoSemNegritoInicial = normalizarTexto(antesDoPrimeiroNegrito)
    const autoria = extrairAutoriaChaveAbnt(ref)
    if (!primeiroNegritoPareceFonte && autoria && textoSemNegritoInicial && textoSemNegritoInicial === autoria) {
      issues.push(tipo === 'artigoPeriodico'
        ? 'Em artigo de periódico, o título do artigo não recebe negrito; o destaque deve ir no nome da revista ou periódico.'
        : 'Em artigo de jornal, o título da matéria não recebe negrito; o destaque deve ir no nome do jornal.')
    }

    const indiceNegrito = text.indexOf(primeiroNegrito)
    const indiceVolumeOuPagina = text.search(/\b(?:v\.|n\.|p\.)\s*/i)
    if (indiceVolumeOuPagina >= 0 && indiceNegrito > indiceVolumeOuPagina) {
      issues.push(tipo === 'artigoPeriodico'
        ? 'O nome da revista ou periódico deve aparecer em negrito antes dos dados de volume, número e páginas.'
        : 'O nome do jornal deve aparecer em negrito antes dos dados de data, seção ou página.')
    }
  }

  return Array.from(new Set(issues))
}

function auditarReferenciaAbnt(ref, avisosExtras) {
  const original = String(ref.text || '')
  const text = normalizarEspacos(original)
  const tipo = classificarReferenciaAbnt(text)
  const issues = []
  ;(avisosExtras || []).forEach(aviso => issues.push(aviso))
  const temUrl = /https?:\/\/|www\./i.test(text)
  const normal = normalizarTexto(text)
  const temDisponivel = /\bDISPONI?VEL EM\b|\bDISPON\s+VEL EM\b/.test(normal)
  const temAcesso = /\bACESSO EM\b/.test(normal)
  const ano = /(?:18|19|20)\d{2}|\[\d{4}\]|\[\d{2}--\]|\[20--\]|\[19--\]/.test(text)

  if (!text) return { tipo, issues: ['Referência vazia.'] }
  if (!/[.!?]$/.test(text)) issues.push('A referência deve terminar com ponto final.')
  if (/\s{2,}/.test(original.replace(/\u00a0/g, ' '))) issues.push('Há espaços duplicados na referência.')
  problemasEspacoIndicadores(text).forEach(issue => issues.push(issue))
  if (autoriaSubstituidaPorLinha(text)) {
    issues.push('A linha de substituição de autoria ("_______.") não é aceita pela regra atual; repita o autor por extenso.')
  }
  if (!ano) issues.push('Ano/data de publicação não identificado.')
  if (!temAutoriaAbnt(text) && tipo !== 'legislacao' && !autoriaSubstituidaPorLinha(text)) {
    issues.push('Elemento de autoria não parece estar no formato SOBRENOME, Prenome. ou ENTIDADE.')
  }
  if (autoresMultiplosSemPontoEVirgula(text)) {
    issues.push('Autores múltiplos devem ser separados por ponto e vírgula: GOMES, A. C.; VECHI, C. A.')
  }
  if (etAlAbntIncorreto(text)) {
    issues.push('A expressão "et al." deve terminar com ponto.')
  }
  if (/^[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(?:\s+[A-ZÀ-Ý][A-ZÀ-Ý'’-]+)*,\s+[^.;]+;\s+et\s+al\./i.test(text)) {
    issues.push('A expressão <i>et al.</i> deve vir após o primeiro autor, sem ponto e vírgula: MARQUES, Luís Maurício <i>et al.</i>')
  }
  if (contarAutoresExplícitos(text) >= 4) {
    issues.push('Sugere-se utilizar <i>et al.</i> para quatro ou mais autores.')
  }
  validarItalicosReferencia(ref).forEach(issue => issues.push(issue))
  validarNegritoReferencia(ref, tipo).forEach(issue => issues.push(issue))

  if (temUrl || temDisponivel || temAcesso) {
    if (!temDisponivel) issues.push('Documento online deve trazer "Disponível em:".')
    if (!temAcesso) issues.push('Documento online deve trazer "Acesso em:".')
    const acessoComMaioAbreviado = new RegExp(`Acesso em:\\s*${DIA_ACESSO_ABNT_RE.source}\\s+mai\\.\\s+(?:18|19|20)\\d{2}`, 'i').test(text)
    if (acessoComMaioAbreviado) {
      issues.push('O mês de maio não deve ser abreviado na data de acesso: use "maio", não "mai.".')
    } else if (temAcesso && !new RegExp(`Acesso em:\\s*${DIA_ACESSO_ABNT_RE.source}\\s+${MESES_ABNT_RE.source}\\s+(?:18|19|20)\\d{2}`, 'i').test(text)) {
      issues.push('Data de acesso deve seguir o padrão "Acesso em: 1º jul. 2021." ou "Acesso em: 8 fev. 2018.".')
    }
  }

  if (/\bdoi\b/i.test(text) && !/https?:\/\/doi\.org\/|doi:\s*10\./i.test(text)) {
    issues.push('DOI deve estar em formato reconhecível, como https://doi.org/... ou doi: 10....')
  }

  if (tipo === 'livro') {
    if (!/:\s*[^,.;]+,\s*(?:\[[^\]]+\]|(?:18|19|20)\d{2})/.test(text)) {
      issues.push('Livro/monografia deve indicar local, editora e ano no padrão "Local: Editora, ano.".')
    }
  } else if (tipo === 'capitulo') {
    if (!/\bIn:\s*[^.]+/i.test(text)) issues.push('Parte de monografia deve conter "In:".')
    if (!/:\s*[^,.;]+,\s*(?:\[[^\]]+\]|(?:18|19|20)\d{2})/.test(text)) {
      issues.push('Parte de monografia deve indicar dados da obra no todo, com local, editora e ano.')
    }
  } else if (tipo === 'artigoPeriodico') {
    if (/\bIn:\s/i.test(text)) issues.push('Uso de "In:" inadequado para revista ou periódico.')
    if (!/\bp\.\s*[A-Z]?\d+(?:\s*[-–]\s*[A-Z]?\d+)?/i.test(text)) issues.push('Artigo de periódico deve indicar páginas com "p.".')
  } else if (tipo === 'tese') {
    if (!/\b(?:Tese|Disserta[cç][aã]o|Trabalho de Conclus[aã]o de Curso)\b/i.test(text)) issues.push('Trabalho acadêmico deve indicar o tipo do trabalho.')
    if (!/\((?:Mestrado|Doutorado|Bacharelado|Especializa[cç][aã]o|Gradua[cç][aã]o)/i.test(text)) issues.push('Trabalho acadêmico deve indicar grau/curso entre parênteses.')
  } else if (tipo === 'legislacao') {
    if (!/\b(?:BRASIL|[A-ZÀ-Ý][A-ZÀ-Ý ]+)\./.test(text)) issues.push('Documento jurídico deve iniciar pela jurisdição ou entidade responsável.')
  } else if (tipo === 'desconhecido') {
    issues.push('Não foi possível classificar automaticamente o tipo da referência.')
  }

  return { tipo, issues }
}

function aplicarMarcacoes(matches, referencias) {
  const list = []
  const matchesByNode = new Map()

  matches.forEach((match, index) => {
    const resultados = match.units.map(unit => ({
      unit,
      ...vincularUnidade(unit, referencias),
    }))
    const issues = Array.from(new Set(
      (match.issues || []).concat(
        resultados
          .map(resultado => problemaCaixaAltaAutorCitacao(resultado.unit, resultado.ref))
          .filter(Boolean),
        resultados
          .flatMap(resultado => problemasAutoresCitacao(resultado.unit, resultado.ref))
          .filter(Boolean),
        resultados
          .map(resultado => problemaNomeSimilarAutorCitacao(resultado.unit, resultado.ref))
          .filter(Boolean),
      ),
    ))
    const status = classeResultado(resultados.map(r => r.status))
    const id = `ref-${Date.now()}-${index}`
    if (!matchesByNode.has(match.node)) matchesByNode.set(match.node, [])
    matchesByNode.get(match.node).push({ ...match, id, resultados, status, issues })
  })

  matchesByNode.forEach((nodeMatches, node) => {
    if (!node.parentNode) return
    const text = node.nodeValue
    const ordered = nodeMatches
      .sort((a, b) => a.start - b.start || b.end - a.end)
      .filter((match, index, arr) => index === 0 || match.start >= arr[index - 1].end)

    const fragment = document.createDocumentFragment()
    let cursor = 0

    ordered.forEach(match => {
      if (match.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)))

      const span = document.createElement('span')
      span.className = `ref-mark ${match.status}`
      if (match.status === 'ok' && match.issues?.length) span.classList.add('format-warning')
      span.dataset.occurrenceId = match.id
      span.title = match.resultados.map(r => `${r.unit.raw}: ${textoStatus(r.status)}`)
        .concat(match.status === 'ok' && match.issues?.length ? ['Checagem ABNT pendente'] : [])
        .join('\n')
      span.textContent = text.slice(match.start, match.end)
      fragment.appendChild(span)

      list.push({
        id: match.id,
        text: span.textContent,
        status: match.status,
        resultados: match.resultados,
        issues: match.issues || [],
        element: span,
      })

      if (match.issues?.length) {
        list.push({
          id: `${match.id}-abnt`,
          text: span.textContent,
          status: 'format',
          resultados: [],
          referenceText: span.textContent,
          referenceType: 'citacao',
          issues: match.issues,
          element: span,
        })
      }

      cursor = match.end
    })

    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)))
    node.parentNode.replaceChild(fragment, node)
  })

  return list
}

function anexarProblemasAbnt(list, referencias) {
  const gruposAutorAno = {}
  let ultimaAutoriaExplicita = ''
  let ultimaAutoriaAgrupamentoExplicita = ''
  referencias.forEach(ref => {
    const autoriaExtraida = extrairAutoriaChaveAbnt(ref)
    const autoriaAgrupamentoExtraida = extrairAutoriaAgrupamentoAno(ref)
    const autoria = autoriaSubstituidaPorLinha(ref.text)
      ? ultimaAutoriaAgrupamentoExplicita || ultimaAutoriaExplicita
      : autoriaAgrupamentoExtraida
    if (autoriaExtraida && !autoriaSubstituidaPorLinha(ref.text)) {
      ultimaAutoriaExplicita = autoriaExtraida
      ultimaAutoriaAgrupamentoExplicita = autoriaAgrupamentoExtraida || autoriaExtraida
    }
    const ano = extrairAnoReferenciaPrincipal(ref)
    const anoBase = ano.replace(/[a-z]$/i, '')
    if (!autoria || !anoBase) return
    const chave = `${autoria}__${anoBase}`
    if (!gruposAutorAno[chave]) gruposAutorAno[chave] = []
    gruposAutorAno[chave].push({ ref, ano, anoBase })
  })

  const avisosPorReferencia = {}
  Object.keys(gruposAutorAno).forEach(chave => {
    const grupo = gruposAutorAno[chave]
    if (grupo.length < 2) return
    grupo.forEach((item, index) => {
      const letraEsperada = String.fromCharCode(97 + index)
      const anoEsperado = `${item.anoBase}${letraEsperada}`
      item.ref.anoEsperado = anoEsperado
      item.ref.anoBaseDuplicado = item.anoBase
      item.ref.anoGrupoCorrecao = chave
      if (item.ano === anoEsperado) return
      if (!avisosPorReferencia[item.ref.index]) avisosPorReferencia[item.ref.index] = []
      avisosPorReferencia[item.ref.index].push(`Há mais de uma obra do mesmo autor em ${item.anoBase}; nesta posição da lista, o ano deve ser ${anoEsperado}.`)
    })
  })

  referencias.forEach(ref => {
    const audit = auditarReferenciaAbnt(ref, avisosPorReferencia[ref.index])
    if (!audit.issues.length) return

    const id = `format-${Date.now()}-${ref.index}`
    if (ref.element?.isConnected) {
      ref.element.classList.add('ref-format')
      ref.element.dataset.occurrenceId = id
      ref.element.title = audit.issues.join('\n')
    }
    list.push({
      id,
      text: ref.text,
      status: 'format',
      resultados: [],
      referenceText: ref.text,
      referenceType: audit.tipo,
      autoriaSubstituta: ref.autoriaSubstituta || '',
      autoriaGrupoCorrecao: ref.autoriaGrupoCorrecao || '',
      anoEsperado: ref.anoEsperado || '',
      anoBaseDuplicado: ref.anoBaseDuplicado || '',
      anoGrupoCorrecao: ref.anoGrupoCorrecao || '',
      issues: audit.issues,
      element: ref.element,
    })
  })

  return list
}

function prepararReferenciasClicaveis(referencias) {
  referencias.forEach(ref => {
    if (!ref.element?.isConnected) return
    ref.element.classList.add('ref-list-entry')
    ref.element.dataset.refIndex = String(ref.index)
  })
}

function estiloKeyDoBloco(block) {
  return block?.dataset?.styleId || block?.dataset?.styleName || ''
}

function estiloLabelDoBloco(block) {
  const name = block?.dataset?.styleName || ''
  const id = block?.dataset?.styleId || ''
  return name || id || 'Sem estilo'
}

function estilosDisponiveisParaCapitulos() {
  const grupos = new Map()
  blocosTexto().forEach(block => {
    const key = estiloKeyDoBloco(block)
    if (!key) return
    const styleName = (block?.dataset?.styleName || '').trim()
    if (!styleName.startsWith('_TITULOS')) return
    if (!grupos.has(key)) {
      grupos.set(key, {
        key,
        label: estiloLabelDoBloco(block),
        blocks: [],
      })
    }
    grupos.get(key).blocks.push(block)
  })
  return Array.from(grupos.values())
    .filter(grupo => grupo.blocks.length > 0)
    .sort((a, b) => b.blocks.length - a.blocks.length || a.label.localeCompare(b.label))
}

function referenciasDentroDoIntervalo(refHeadings, start, end) {
  return refHeadings.filter(item => item.index > start && item.index < end)
}

function montarEscoposPorEstilo(styleKey) {
  const blocks = blocosTexto()
  const titleIndexes = blocks
    .map((block, index) => ({ block, index }))
    .filter(item => estiloKeyDoBloco(item.block) === styleKey)
  const refHeadings = encontrarSecoesReferenciasElegiveis()
  const scopes = []

  titleIndexes.forEach((title, i) => {
    const nextTitleIndex = titleIndexes[i + 1]?.index ?? blocks.length
    const refs = referenciasDentroDoIntervalo(refHeadings, title.index, nextTitleIndex)
    if (!refs.length) return
    const refHeading = refs[refs.length - 1]
    scopes.push({
      id: `chapter-${scopes.length}`,
      title: textoBloco(title.block) || `Capítulo ${scopes.length + 1}`,
      titleBlock: title.block,
      startIndex: title.index,
      endIndex: nextTitleIndex,
      secao: {
        blocks,
        headingIndex: refHeading.index,
        bodyBlocks: blocks.slice(title.index, refHeading.index),
        referenceBlocks: blocks.slice(refHeading.index + 1, nextTitleIndex),
        heading: refHeading.el,
      },
    })
  })
  return scopes
}

function atualizarPreviewEstiloCapitulo() {
  if (!chapterStyleSelect || !chapterStylePreview || !pendingChapterSetup) return
  const styleKey = chapterStyleSelect.value
  const grupo = pendingChapterSetup.styles.find(item => item.key === styleKey)
  const scopes = montarEscoposPorEstilo(styleKey)
  const titulos = (grupo?.blocks || []).map(block => textoBloco(block)).filter(Boolean)
  chapterStylePreview.innerHTML = `
    <p><strong>${scopes.length}</strong> capítulo(s) com lista de referências detectada(s). <strong>${titulos.length}</strong> título(s) usam esse estilo.</p>
    <ol>${titulos.slice(0, 40).map(titulo => `<li>${escHtml(titulo)}</li>`).join('')}</ol>
    ${titulos.length > 40 ? '<p>Lista abreviada para visualização.</p>' : ''}
  `
}

function abrirPainelEscolhaCapitulos(styles) {
  pendingChapterSetup = { styles }
  chapterStyleSelect.innerHTML = styles.map(style => (
    `<option value="${escHtml(style.key)}">${escHtml(style.label)} — ${style.blocks.length} parágrafo(s)</option>`
  )).join('')
  atualizarPreviewEstiloCapitulo()
  chapterSetupModal?.classList.remove('hidden')
}

function fecharPainelEscolhaCapitulos() {
  pendingChapterSetup = null
  chapterSetupModal?.classList.add('hidden')
}

function renderChapterNav() {
  if (!chapterNav) return
  if (!chapterScopes.length) {
    chapterNav.classList.add('hidden')
    chapterNav.innerHTML = ''
    return
  }
  chapterNav.classList.remove('hidden')
  chapterNav.innerHTML = chapterScopes.map((scope, index) => `
    <button type="button" class="${index === activeChapterIndex ? 'active' : ''}" data-chapter-index="${index}">
      <strong>${String(index + 1).padStart(2, '0')}</strong>
      <span>${escHtml(scope.title)}</span>
    </button>
  `).join('')
}

function aplicarEstiloVisualTitulosCapitulo() {
  editor.querySelectorAll('.chapter-title-block').forEach(el => el.classList.remove('chapter-title-block'))
  chapterScopes.forEach(scope => {
    scope.titleBlock?.classList.add('chapter-title-block')
  })
}

function conferirEscopo(secao, chapterLabel) {
  stripMarks()
  if (secao.heading) secao.heading.classList.add('refs-heading')

  const referencias = montarReferencias(secao.referenceBlocks)
  const citacoes = coletarCitacoes(secao.bodyBlocks, referencias)
  occurrences = anexarProblemasAbnt(aplicarMarcacoes(citacoes, referencias), referencias)
  prepararReferenciasClicaveis(referencias)
  ultimoResultado = { secao, referencias, citacoes, occurrences, chapterLabel }
  renderFilters()
  renderOccurrences()
  renderReferencesPanel(referencias)
  renderSummary(ultimoResultado)
  renderChapterNav()
  aplicarEstiloVisualTitulosCapitulo()
  if (textSearchInput?.value) executarBuscaTexto(0, { navegar: false })
}

function ativarCapitulo(index) {
  if (!chapterScopes[index]) return
  activeChapterIndex = index
  const scope = chapterScopes[index]
  conferirEscopo(scope.secao, scope.title)
  scope.titleBlock?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function usarDocumentoUnico() {
  editor.querySelectorAll('.chapter-title-block').forEach(el => el.classList.remove('chapter-title-block'))
  chapterScopes = []
  activeChapterIndex = -1
  renderChapterNav()
  fecharPainelEscolhaCapitulos()
  conferirReferencias()
}

function continuarComCapitulos() {
  const styleKey = chapterStyleSelect?.value || ''
  const scopes = montarEscoposPorEstilo(styleKey)
  if (!scopes.length) {
    if (chapterStylePreview) {
      chapterStylePreview.innerHTML += '<p class="chapter-warning">Nenhum capítulo válido foi encontrado com esse estilo.</p>'
    }
    return
  }
  chapterScopes = scopes
  activeChapterIndex = 0
  fecharPainelEscolhaCapitulos()
  ativarCapitulo(0)
}

function conferirReferencias() {
  if (chapterScopes.length && activeChapterIndex >= 0) {
    const scope = chapterScopes[activeChapterIndex]
    conferirEscopo(scope.secao, scope.title)
    return
  }
  stripMarks()
  normalizarQuebrasSoltas()
  const secao = encontrarSecaoReferencias()
  if (secao.heading) secao.heading.classList.add('refs-heading')

  const referencias = montarReferencias(secao.referenceBlocks)
  const citacoes = coletarCitacoes(secao.bodyBlocks, referencias)
  occurrences = anexarProblemasAbnt(aplicarMarcacoes(citacoes, referencias), referencias)
  prepararReferenciasClicaveis(referencias)
  ultimoResultado = { secao, referencias, citacoes, occurrences }
  renderFilters()
  renderOccurrences()
  renderReferencesPanel(referencias)
  renderSummary(ultimoResultado)
  if (textSearchInput?.value) executarBuscaTexto(0, { navegar: false })
}

function renderSummary(resultado) {
  if (!resultado) {
    summaryEl.textContent = 'Importe ou cole um texto para começar.'
    countBadge.textContent = '0'
    return
  }
  const total = occurrences.length
  const ok = occurrences.filter(o => o.status === 'ok').length
  const partial = occurrences.filter(o => o.status === 'partial').length
  const warning = occurrences.filter(o => o.status === 'warning').length
  const authorless = occurrences.filter(o => o.status === 'authorless').length
  const missing = occurrences.filter(o => o.status === 'missing').length
  const format = occurrences.filter(o => o.status === 'format').length
  const refs = resultado.referencias.length
  const citacoes = resultado.citacoes.length
  const heading = resultado.secao.heading ? 'seção de referências encontrada' : 'seção de referências não encontrada'
  const correcoes = correcoesAplicadas.length
  const chapter = resultado.chapterLabel ? ` em <strong>${escHtml(resultado.chapterLabel)}</strong>` : ''
  summaryEl.innerHTML = `
    <strong>${total}</strong> ocorrência(s)${chapter}: <strong>${citacoes}</strong> citação(ões) no texto, <strong>${refs}</strong> referência(s), ${heading}.<br>
    Encontradas: <strong>${ok}</strong> · Parciais: <strong>${partial}</strong> · Ano divergente: <strong>${warning}</strong> · Autor ausente: <strong>${authorless}</strong> · Ausentes: <strong>${missing}</strong> · Checagem ABNT: <strong>${format}</strong>${correcoes ? ` · Correções validadas: <strong>${correcoes}</strong>` : ''}
  `
  countBadge.textContent = String(total)
}

function renderFilters() {
  const groups = [
    ['todos', 'Todos'],
    ['ok', 'Encontradas'],
    ['partial', 'Parciais'],
    ['warning', 'Ano divergente'],
    ['authorless', 'Autor ausente'],
    ['missing', 'Ausentes'],
    ['format', 'Checagem ABNT'],
  ]
  filtersEl.innerHTML = groups.map(([id, label]) => (
    `<button type="button" class="filter ${id}${activeFilter === id ? ' active' : ''}" data-filter="${id}">${label}</button>`
  )).join('')
}

function citacoesDaReferencia(refIndex) {
  const links = []
  const vistos = new Set()
  occurrences.forEach(item => {
    if (!item?.element?.isConnected || item.status === 'format') return
    ;(item.resultados || []).forEach(resultado => {
      if (resultado.ref?.index !== refIndex) return
      const texto = normalizarEspacos(resultado.unit?.raw || item.text || '')
      const chave = `${item.id}__${texto}`
      if (!texto || vistos.has(chave)) return
      vistos.add(chave)
      links.push({
        id: item.id,
        text: texto,
        status: resultado.status,
      })
    })
  })
  return links
}

function limparUrl(raw) {
  return String(raw || '')
    .replace(/^<+/, '')
    .replace(/[>\])}.,;:]+$/g, '')
}

function extrairUrls(text) {
  const urls = []
  const vistos = new Set()
  const re = /\bhttps?:\/\/[^\s<>"'\])}]+/gi
  let match
  while ((match = re.exec(String(text || '')))) {
    const url = limparUrl(match[0])
    if (!url || vistos.has(url)) continue
    vistos.add(url)
    urls.push(url)
  }
  return urls
}

function urlsDasReferencias(referencias) {
  const lista = []
  ;(referencias || []).forEach(ref => {
    extrairUrls(ref.text).forEach(url => {
      lista.push({ refIndex: ref.index, url })
    })
  })
  return lista
}

function statusUrlInfo(resultado) {
  if (!resultado) return { cls: 'idle', label: 'Não validado' }
  if (resultado.pending) return { cls: 'pending', label: 'Verificando...' }
  if (resultado.ok) {
    const extra = resultado.redirecionado ? ' com redirecionamento' : ''
    return { cls: 'ok', label: `Online${resultado.status ? ` (${resultado.status})` : ''}${extra}` }
  }
  if (resultado.status === 403 || resultado.status === 401) {
    return { cls: 'warning', label: `Não verificável (${resultado.status})` }
  }
  if (/ECONNRESET|socket hang up|network socket|connection reset/i.test(resultado.erro || '')) {
    return { cls: 'warning', label: 'Não verificável' }
  }
  if (resultado.status) {
    return { cls: 'error', label: `Problema (${resultado.status})` }
  }
  return { cls: 'error', label: resultado.erro ? `Erro: ${resultado.erro}` : 'Problema ao validar' }
}

function renderUrlStatus(refIndex, url) {
  const resultado = urlValidationState[refIndex]?.[url]
  const info = statusUrlInfo(resultado)
  return `
    <div class="reference-url-item ${info.cls}">
      <a href="${escHtml(url)}" target="_blank" rel="noreferrer">${escHtml(url)}</a>
      <span>${escHtml(info.label)}</span>
    </div>
  `
}

function renderReferenceUrls(ref) {
  const urls = extrairUrls(ref.text)
  if (!urls.length) return ''
  return `
    <div class="reference-url-list" aria-label="URLs da referência">
      ${urls.map(url => renderUrlStatus(ref.index, url)).join('')}
    </div>
  `
}

function atualizarBotaoValidarUrls() {
  if (!validateUrlsBtn) return
  const urls = urlsDasReferencias(ultimoResultado?.referencias || [])
  const disponivel = !!(window.refsBridge && typeof window.refsBridge.validarUrls === 'function')
  validateUrlsBtn.disabled = urlValidationRunning || !urls.length || !disponivel
  validateUrlsBtn.textContent = urlValidationRunning
    ? 'Validando...'
    : urls.length
      ? `Validar URLs (${urls.length})`
      : 'Validar URLs'
  validateUrlsBtn.title = disponivel
    ? (urls.length ? 'Validar URLs encontradas na lista de referências.' : 'Nenhuma URL encontrada nas referências.')
    : 'Disponível apenas no app desktop.'
}

function renderReferencesPanel(referencias) {
  if (!referencesListEl || !referencesCountEl) return
  referencesCountEl.textContent = String(referencias.length || 0)
  if (!referencias.length) {
    referencesListEl.className = 'references-list empty'
    referencesListEl.textContent = 'A lista de referências aparecerá aqui após a conferência.'
    atualizarBotaoValidarUrls()
    return
  }

  referencesListEl.className = 'references-list'
  referencesListEl.innerHTML = referencias.map(ref => {
    const citacoes = citacoesDaReferencia(ref.index)
    const links = citacoes.length
      ? citacoes.map(citacao => `
        <button type="button" class="reference-cite-link ${citacao.status}" data-cite-id="${citacao.id}">
          ${escHtml(citacao.text)}
        </button>
      `).join('')
      : '<span class="reference-cite-empty">⚠️ Nenhuma citação vinculada.</span>'
    return `
      <article class="reference-item" data-ref-card="${ref.index}">
        <button type="button" class="reference-main" data-ref-index="${ref.index}">
          <strong>${String(ref.index + 1).padStart(2, '0')}</strong>
          <span>${escHtml(ref.text)}</span>
        </button>
        ${renderReferenceUrls(ref)}
        <div class="reference-citations">${links}</div>
      </article>
    `
  }).join('')
  atualizarBotaoValidarUrls()
}

async function validarUrlsReferencias() {
  const referencias = ultimoResultado?.referencias || []
  const pares = urlsDasReferencias(referencias)
  if (!pares.length || urlValidationRunning) return
  if (!window.refsBridge || typeof window.refsBridge.validarUrls !== 'function') {
    alert('A validação de URLs está disponível apenas no app desktop.')
    return
  }

  urlValidationRunning = true
  pares.forEach(({ refIndex, url }) => {
    if (!urlValidationState[refIndex]) urlValidationState[refIndex] = {}
    urlValidationState[refIndex][url] = { pending: true }
  })
  renderReferencesPanel(referencias)

  try {
    const urlsUnicas = Array.from(new Set(pares.map(item => item.url)))
    const resultados = await window.refsBridge.validarUrls(urlsUnicas)
    const porUrl = {}
    ;(resultados || []).forEach(resultado => {
      porUrl[resultado.url] = resultado
    })
    pares.forEach(({ refIndex, url }) => {
      if (!urlValidationState[refIndex]) urlValidationState[refIndex] = {}
      urlValidationState[refIndex][url] = porUrl[url] || {
        url,
        ok: false,
        status: null,
        finalUrl: url,
        erro: 'Sem resposta da validação'
      }
    })
  } catch (err) {
    pares.forEach(({ refIndex, url }) => {
      if (!urlValidationState[refIndex]) urlValidationState[refIndex] = {}
      urlValidationState[refIndex][url] = {
        url,
        ok: false,
        status: null,
        finalUrl: url,
        erro: err.message || String(err)
      }
    })
  } finally {
    urlValidationRunning = false
    renderReferencesPanel(referencias)
  }
}

function filteredOccurrences() {
  return activeFilter === 'todos'
    ? occurrences
    : occurrences.filter(o => o.status === activeFilter)
}

function renderOccurrences() {
  const list = filteredOccurrences()
  if (!occurrences.length) {
    occurrencesEl.className = 'occurrences empty'
    occurrencesEl.textContent = 'Nenhuma ocorrência marcada.'
    countBadge.textContent = '0'
    return
  }

  occurrencesEl.className = 'occurrences'
  occurrencesEl.innerHTML = list.map(o => {
    if (o.status === 'format') {
      const tipo = ABNT_TIPOS[o.referenceType] || ABNT_TIPOS.desconhecido
      const issues = (o.issues || []).map(issue => `<li>${formatIssueHtml(issue)}</li>`).join('')
      return `
        <button type="button" class="occurrence ${o.status}${o.id === activeOccurrenceId ? ' active' : ''}" data-id="${o.id}">
          <strong>${textoStatus(o.status)}</strong>
          <span class="reference">${escHtml(o.text)}</span>
          <span class="abnt-type">${escHtml(tipo)}</span>
          <ul class="issue-list">${issues}</ul>
        </button>
      `
    }
    const refs = o.resultados.map(r => {
      const refText = r.ref?.text || 'Referência não encontrada.'
      const detalharUnidade = o.resultados.length > 1
        || r.status !== o.status
        || o.status !== 'ok'
      return `
        ${detalharUnidade ? `<span>${escHtml(r.unit.raw)} — ${textoStatus(r.status)}</span>` : ''}
        <span class="reference">${escHtml(refText)}</span>
      `
    }).join('')
    return `
      <button type="button" class="occurrence ${o.status}${o.id === activeOccurrenceId ? ' active' : ''}" data-id="${o.id}">
        <strong>${textoStatus(o.status)}</strong>
        <span>${escHtml(o.text)}</span>
        ${refs}
      </button>
    `
  }).join('')
}

function focusOccurrence(id) {
  const item = occurrences.find(o => o.id === id)
  if (!item?.element?.isConnected) return

  document.querySelectorAll('.ref-mark.active, .ref-format.active').forEach(el => el.classList.remove('active'))
  item.element.classList.add('active')
  activeOccurrenceId = id
  renderOccurrences()

  item.element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const range = document.createRange()
  range.selectNodeContents(item.element)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

function textoAtualOcorrencia(item) {
  if (item?.element?.isConnected) return item.element.textContent || ''
  return item?.referenceText || item?.text || ''
}

function ocorrenciaPodeSerCorrigida(item) {
  if (!item?.element?.isConnected) return false
  return item.element.classList.contains('ref-mark')
    || item.element.classList.contains('ref-format')
    || item.referenceType === 'referencia-manual'
}

function ocorrenciaEhCitacao(item) {
  return item?.element?.classList.contains('ref-mark') || item?.referenceType === 'citacao'
}

function ocorrenciaEhReferenciaLista(item) {
  return !!item?.element?.classList.contains('ref-format') || item?.referenceType === 'referencia-manual'
}

function chaveCorrecaoGlobal(item) {
  if (!ocorrenciaEhReferenciaLista(item)) return ''
  if (item?.anoGrupoCorrecao && item?.anoEsperado) return `ano:${item.anoGrupoCorrecao}`
  if (
    item?.autoriaGrupoCorrecao
    && item?.autoriaSubstituta
    && autoriaSubstituidaPorLinha(textoAtualOcorrencia(item))
  ) {
    return `autoria:${item.autoriaGrupoCorrecao}`
  }
  return ''
}

function tipoCorrecaoGlobal(item) {
  const chave = chaveCorrecaoGlobal(item)
  if (chave.startsWith('ano:')) return 'ano'
  if (chave.startsWith('autoria:')) return 'autoria'
  return ''
}

function grupoCorrecaoGlobal(item) {
  const chave = chaveCorrecaoGlobal(item)
  if (!chave) return []
  const vistos = new Set()
  return occurrences.filter(ocorrencia => {
    if (!ocorrenciaPodeSerCorrigida(ocorrencia) || !ocorrenciaEhReferenciaLista(ocorrencia)) return false
    if (chaveCorrecaoGlobal(ocorrencia) !== chave) return false
    if (!ocorrencia.element?.isConnected || vistos.has(ocorrencia.element)) return false
    vistos.add(ocorrencia.element)
    return true
  })
}

function labelCorrecaoGlobal(item, quantidade) {
  const tipo = tipoCorrecaoGlobal(item)
  const detalhe = tipo === 'ano'
    ? 'mesmo autor/ano'
    : 'autoria repetida'
  return `Corrigir sequência (${quantidade} referências, ${detalhe})`
}

function ocorrenciaBaseDaCitacao(item) {
  if (!item?.element?.isConnected) return item
  if (item.resultados?.length) return item
  return occurrences.find(o => o.element === item.element && o.status !== 'format' && o.resultados?.length) || item
}

function corrigirEspacoIndicadores(text) {
  return String(text || '').replace(/\b([pvn])\.(?=\d)/gi, (match, letra) => `${letra}. `)
}

function formatarMilharNumero(numero) {
  return String(numero || '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function corrigirMilharPaginas(text) {
  return String(text || '').replace(
    /\bp\.\s*(\d{4,})(?![\d.])(?:\s*([-–—])\s*(\d{4,})(?![\d.]))?/gi,
    (match, inicio, separador, fim) => {
      const primeiro = formatarMilharNumero(inicio)
      const segundo = fim ? `${separador || '-'}${formatarMilharNumero(fim)}` : ''
      return `p. ${primeiro}${segundo}`
    },
  )
}

function corrigirIndicadoresBibliograficos(text) {
  return corrigirMilharPaginas(corrigirEspacoIndicadores(text))
}

function sugerirAutoriaSubstituida(item, text) {
  const autor = normalizarEspacos(item?.autoriaSubstituta || '')
  if (!autor || !autoriaSubstituidaPorLinha(text)) return text
  return String(text || '').replace(/^_{3,}\.?\s*/, `${autor}. `)
}

function aplicarAnoEsperadoEmTrecho(text, anoBase, anoEsperado) {
  if (!anoBase || !anoEsperado) return text
  const re = new RegExp(`\\b${anoBase}[a-z]?\\b`, 'gi')
  return String(text || '').replace(re, anoEsperado)
}

function sugerirAnoDuplicado(item, text) {
  const anoEsperado = String(item?.anoEsperado || '')
  const anoBase = String(item?.anoBaseDuplicado || '').replace(/[a-z]$/i, '')
  if (!anoEsperado || !anoBase) return text

  const valor = String(text || '')
  const corteOnline = valor.search(/Dispon\S*\s+em:?|Acesso\s+em:?|https?:\/\//i)
  const limite = corteOnline >= 0 ? corteOnline : valor.length
  const antesOnline = valor.slice(0, limite)
  const depoisOnline = valor.slice(limite)

  if (item?.referenceType === 'legislacao') {
    return aplicarAnoEsperadoEmTrecho(antesOnline, anoBase, anoEsperado) + depoisOnline
  }

  const ultimo = indiceUltimoAnoPrincipal(valor)
  if (!ultimo) return valor
  const baseEncontrada = ultimo.text.replace(/[a-z]$/i, '')
  if (baseEncontrada !== anoBase) return valor
  return valor.slice(0, ultimo.index) + anoEsperado + valor.slice(ultimo.index + ultimo.text.length)
}

function textNodesDoFragmento(root) {
  const nodes = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) nodes.push(node)
  return nodes
}

function textoDoFragmento(root) {
  return textNodesDoFragmento(root).map(node => node.nodeValue || '').join('')
}

function substituirIntervaloTextoFragmento(root, start, end, replacement) {
  const nodes = textNodesDoFragmento(root)
  let offset = 0
  let replacementInserted = false
  nodes.forEach(node => {
    const value = node.nodeValue || ''
    const nodeStart = offset
    const nodeEnd = offset + value.length
    offset = nodeEnd
    if (nodeEnd <= start || nodeStart >= end) return

    const localStart = Math.max(0, start - nodeStart)
    const localEnd = Math.min(value.length, end - nodeStart)
    const prefix = value.slice(0, localStart)
    const suffix = value.slice(localEnd)
    if (!replacementInserted) {
      node.nodeValue = `${prefix}${replacement}${suffix}`
      replacementInserted = true
    } else {
      node.nodeValue = suffix
    }
  })
}

function substituirIntervalosTextoFragmento(root, ranges) {
  ranges
    .filter(range => range && range.end > range.start)
    .sort((a, b) => b.start - a.start)
    .forEach(range => substituirIntervaloTextoFragmento(root, range.start, range.end, range.replacement))
}

function aplicarEspacoIndicadoresHtml(root) {
  const text = textoDoFragmento(root)
  const ranges = []
  text.replace(/\b([pvn])\.(?=\d)/gi, (match, letra, index) => {
    ranges.push({ start: index, end: index + match.length, replacement: `${letra}. ` })
    return match
  })
  substituirIntervalosTextoFragmento(root, ranges)
}

function aplicarMilharPaginasHtml(root) {
  const text = textoDoFragmento(root)
  const ranges = []
  text.replace(
    /\bp\.\s*(\d{4,})(?![\d.])(?:\s*([-–—])\s*(\d{4,})(?![\d.]))?/gi,
    (match, inicio, separador, fim, index) => {
      const primeiro = formatarMilharNumero(inicio)
      const segundo = fim ? `${separador || '-'}${formatarMilharNumero(fim)}` : ''
      ranges.push({
        start: index,
        end: index + match.length,
        replacement: `p. ${primeiro}${segundo}`,
      })
      return match
    },
  )
  substituirIntervalosTextoFragmento(root, ranges)
}

function aplicarAutoriaSubstituidaHtml(item, root) {
  const autor = normalizarEspacos(item?.autoriaSubstituta || '')
  if (!autor) return
  const text = textoDoFragmento(root)
  const match = text.match(/^_{3,}\.?\s*/)
  if (!match) return
  substituirIntervaloTextoFragmento(root, 0, match[0].length, `${autor}. `)
}

function aplicarAnoDuplicadoHtml(item, root) {
  const anoEsperado = String(item?.anoEsperado || '')
  const anoBase = String(item?.anoBaseDuplicado || '').replace(/[a-z]$/i, '')
  if (!anoEsperado || !anoBase) return

  const text = textoDoFragmento(root)
  const corteOnline = text.search(/Dispon\S*\s+em:?|Acesso\s+em:?|https?:\/\//i)
  const limite = corteOnline >= 0 ? corteOnline : text.length

  if (item?.referenceType === 'legislacao') {
    const ranges = []
    const re = new RegExp(`\\b${anoBase}[a-z]?\\b`, 'gi')
    let match
    while ((match = re.exec(text.slice(0, limite)))) {
      ranges.push({ start: match.index, end: match.index + match[0].length, replacement: anoEsperado })
    }
    substituirIntervalosTextoFragmento(root, ranges)
    return
  }

  const ultimo = indiceUltimoAnoPrincipal(text)
  if (!ultimo) return
  const baseEncontrada = ultimo.text.replace(/[a-z]$/i, '')
  if (baseEncontrada !== anoBase) return
  substituirIntervaloTextoFragmento(root, ultimo.index, ultimo.index + ultimo.text.length, anoEsperado)
}

function aplicarSugestoesTextoEmHtml(item, html) {
  const template = document.createElement('template')
  template.innerHTML = sanitizarHtmlCorrecao(html)
  const antes = template.innerHTML
  aplicarEspacoIndicadoresHtml(template.content)
  aplicarMilharPaginasHtml(template.content)
  aplicarAutoriaSubstituidaHtml(item, template.content)
  aplicarAnoDuplicadoHtml(item, template.content)
  return template.innerHTML !== antes ? template.innerHTML : ''
}

function aplicarSugestaoTextoGenericaHtml(html, atual, sugestao) {
  if (!html || !sugestao || sugestao === atual) return ''

  let prefixo = 0
  const limitePrefixo = Math.min(atual.length, sugestao.length)
  while (prefixo < limitePrefixo && atual[prefixo] === sugestao[prefixo]) prefixo += 1

  let sufixo = 0
  const limiteSufixo = Math.min(atual.length - prefixo, sugestao.length - prefixo)
  while (
    sufixo < limiteSufixo
    && atual[atual.length - 1 - sufixo] === sugestao[sugestao.length - 1 - sufixo]
  ) {
    sufixo += 1
  }

  const start = prefixo
  const end = atual.length - sufixo
  const replacement = sugestao.slice(prefixo, sugestao.length - sufixo)
  const template = document.createElement('template')
  template.innerHTML = sanitizarHtmlCorrecao(html)
  substituirIntervaloTextoFragmento(template.content, start, end, replacement)
  return template.innerHTML
}

function sugerirCorrecaoOcorrencia(item) {
  const atual = textoAtualOcorrencia(item)
  const base = ocorrenciaBaseDaCitacao(item)
  let sugestao = sugerirAnoDuplicado(item, sugerirAutoriaSubstituida(item, corrigirIndicadoresBibliograficos(atual)))

  ;(base.resultados || []).forEach(resultado => {
    const raw = resultado.unit?.authorsRaw || ''
    const precisaCorrigirAutoria = autoriaCitacaoEmCaixaAlta(raw)
      || (!resultado.unit?.narrativa && autoriaCitacaoTemSeparadorInadequado(raw))
    if (!raw || !precisaCorrigirAutoria) return
    const autoriaCorrigida = corrigirAutoriaCitacao(raw)
    if (autoriaCorrigida && autoriaCorrigida !== raw) {
      sugestao = sugestao.replace(raw, autoriaCorrigida)
    }
  })

  return sugestao
}

function sanitizarHtmlCorrecao(html) {
  const template = document.createElement('template')
  template.innerHTML = String(html || '')
  template.content.querySelectorAll('*').forEach(el => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'b') {
      const strong = document.createElement('strong')
      strong.innerHTML = el.innerHTML
      el.replaceWith(strong)
      return
    }
    if (tag === 'i') {
      const em = document.createElement('em')
      em.innerHTML = el.innerHTML
      el.replaceWith(em)
      return
    }
    if (tag === 'script' || tag === 'style') {
      el.remove()
      return
    }
    if (!['strong', 'em', 'br'].includes(tag)) {
      el.replaceWith(...Array.from(el.childNodes))
      return
    }
    Array.from(el.attributes).forEach(attr => el.removeAttribute(attr.name))
  })
  return template.innerHTML
}

function temProblemaNegritoTitulo(item) {
  return (item?.issues || []).some(issue => (
    /negrito não deve incluir sinais de pontuação/i.test(issue)
    || /subtítulo não deve ficar em negrito/i.test(issue)
  ))
}

function corrigirNegritoTituloHtml(html) {
  const template = document.createElement('template')
  template.innerHTML = sanitizarHtmlCorrecao(html)
  let alterado = false

  Array.from(template.content.querySelectorAll('strong')).forEach(strong => {
    const texto = strong.textContent || ''
    const doisPontos = texto.indexOf(':')
    if (doisPontos > 0 && doisPontos < texto.length - 1) {
      const titulo = texto.slice(0, doisPontos).trim().replace(/[,:.;]+$/g, '')
      const complemento = texto.slice(doisPontos + 1)
      if (!titulo || !normalizarEspacos(complemento)) return

      const novoStrong = document.createElement('strong')
      novoStrong.textContent = titulo
      strong.replaceWith(novoStrong, document.createTextNode(`:${complemento}`))
      alterado = true
      return
    }

    const pontuacaoFinal = texto.match(/([,:.;]+)(\s*)$/)
    if (!pontuacaoFinal) return
    const titulo = texto.slice(0, pontuacaoFinal.index).trimEnd()
    if (!titulo) return

    const novoStrong = document.createElement('strong')
    novoStrong.textContent = titulo
    strong.replaceWith(novoStrong, document.createTextNode(pontuacaoFinal[0]))
    alterado = true
  })

  return alterado ? template.innerHTML : ''
}

function sugerirCorrecaoHtmlOcorrencia(item) {
  if (!ocorrenciaEhReferenciaLista(item) || !item?.element?.isConnected || !temProblemaNegritoTitulo(item)) {
    return ''
  }
  return corrigirNegritoTituloHtml(item.element.innerHTML)
}

function htmlInicialCorrecao(item, sugestao) {
  const atual = textoAtualOcorrencia(item)
  const sugestaoHtml = sugerirCorrecaoHtmlOcorrencia(item)
  if (item?.element?.isConnected) {
    const htmlBase = sugestaoHtml || item.element.innerHTML
    const sugestaoTextoHtml = aplicarSugestoesTextoEmHtml(item, htmlBase)
    if (sugestaoTextoHtml) return sugestaoTextoHtml
    if (sugestaoHtml) return sugestaoHtml
    const sugestaoGenericaHtml = aplicarSugestaoTextoGenericaHtml(htmlBase, atual, sugestao)
    if (sugestaoGenericaHtml) return sugestaoGenericaHtml
  }
  if (sugestao && sugestao !== atual) return escHtml(sugestao)
  if (item?.element?.isConnected) return sanitizarHtmlCorrecao(item.element.innerHTML)
  return escHtml(atual)
}

function htmlAnteriorOcorrencia(item) {
  if (item?.element?.isConnected) return sanitizarHtmlCorrecao(item.element.innerHTML)
  return escHtml(textoAtualOcorrencia(item))
}

function blocoDaSelecaoNode(node) {
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  return el?.closest?.('p, li, h1, h2, h3, h4, h5, h6') || null
}

function htmlDeRange(range) {
  const container = document.createElement('div')
  container.appendChild(range.cloneContents())
  return sanitizarHtmlCorrecao(container.innerHTML)
}

function selecaoAtualDoEditor(opcoes = {}) {
  const acao = opcoes.acao || 'registrar'
  const objeto = opcoes.objeto || 'texto'
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount || selection.isCollapsed) {
    alert(`Selecione um trecho do texto antes de clicar em ${acao}.`)
    return null
  }

  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    alert('A seleção precisa estar dentro do texto importado.')
    return null
  }

  const blocoInicio = blocoDaSelecaoNode(range.startContainer)
  const blocoFim = blocoDaSelecaoNode(range.endContainer)
  if (!blocoInicio || blocoInicio !== blocoFim) {
    alert(`Selecione um trecho dentro de um único parágrafo para registrar ${objeto} no Word.`)
    return null
  }

  const antes = normalizarEspacos(range.toString())
  if (!antes) {
    alert('A seleção não contém texto.')
    return null
  }

  return {
    range: range.cloneRange(),
    bloco: blocoInicio,
    paragrafoAntes: textoBloco(blocoInicio),
    antes,
    antesHtml: htmlDeRange(range),
  }
}

function renderAlteracaoTextoSelecionado(dados) {
  return `
    <div class="correction-box manual-replace-box">
      <div class="correction-before">
        <strong>Texto anterior</strong>
        <p>${dados.antesHtml || escHtml(dados.antes)}</p>
      </div>
      <label for="correctionText">Texto substituto</label>
      <div class="correction-toolbar" aria-label="Formatação do texto substituto">
        <button type="button" data-format-command="bold"><strong>B</strong></button>
        <button type="button" data-format-command="italic"><em>I</em></button>
      </div>
      <div id="correctionText" class="correction-editor" contenteditable="true" role="textbox" aria-multiline="true">${dados.antesHtml || escHtml(dados.antes)}</div>
      <div class="correction-actions">
        <button type="button" class="primary" data-action="apply-selection-correction">Aplicar substituição</button>
        <span>A substituição será registrada para o DOCX corrigido.</span>
      </div>
      <p class="correction-feedback" id="correctionFeedback"></p>
    </div>
  `
}

function abrirModalAlterarTextoSelecionado() {
  if (!importedDocxArrayBuffer) {
    alert('Importe um DOCX antes de registrar substituições para o Word.')
    return
  }
  const dados = selecaoAtualDoEditor({
    acao: 'Alterar texto selecionado',
    objeto: 'a substituição',
  })
  if (!dados) return
  selecaoManualAtual = dados
  sourceModalOccurrenceId = null
  sourceModalItem = null
  if (sourceModalTitle) sourceModalTitle.textContent = 'Alterar texto selecionado'
  if (sourceModalCitation) sourceModalCitation.textContent = 'Correção manual para o Word'
  sourceModalBody.innerHTML = renderAlteracaoTextoSelecionado(dados)
  sourceModal.classList.remove('hidden')
  setTimeout(() => sourceModalBody?.querySelector('#correctionText')?.focus(), 0)
}

function registrarCorrecaoManualTexto(dados, depoisHtml) {
  const htmlFinal = sanitizarHtmlCorrecao(depoisHtml)
  const depois = textoDeHtmlCorrecao(htmlFinal)
  correcoesAplicadas.push({
    id: `correcao-manual-${Date.now()}-${correcoesAplicadas.length + 1}`,
    tipo: 'texto',
    antes: dados.antes,
    depois,
    antesHtml: dados.antesHtml,
    depoisHtml: htmlFinal,
    paragrafoAntes: dados.paragrafoAntes,
    registradaEm: new Date().toISOString(),
  })
  window.refsCorrecoesAplicadas = correcoesAplicadas
  atualizarEstadoExportacao()
}

function destacarCorrecaoManualNaPagina(dados, depoisHtml) {
  if (!dados?.range) return false
  try {
    const template = document.createElement('template')
    template.innerHTML = sanitizarHtmlCorrecao(depoisHtml)
    dados.range.deleteContents()
    dados.range.insertNode(template.content.cloneNode(true))
    editor.normalize()
    if (textSearchInput?.value) executarBuscaTexto(0, { navegar: false })
    return true
  } catch (err) {
    console.warn('Não foi possível refletir a substituição manual na página.', err)
    return false
  }
}

function aplicarCorrecaoSelecaoManual() {
  const editorCorrecao = sourceModalBody?.querySelector('#correctionText')
  const feedback = sourceModalBody?.querySelector('#correctionFeedback')
  if (!selecaoManualAtual || !editorCorrecao) return

  const depoisHtml = sanitizarHtmlCorrecao(editorCorrecao.innerHTML)
  const depois = textoDeHtmlCorrecao(depoisHtml)
  if (!normalizarEspacos(depois)) {
    if (feedback) feedback.textContent = 'Informe o texto substituto antes de aplicar.'
    return
  }
  if (selecaoManualAtual.antes === depois && selecaoManualAtual.antesHtml === depoisHtml) {
    if (feedback) feedback.textContent = 'O texto substituto está igual ao trecho selecionado.'
    return
  }

  registrarCorrecaoManualTexto(selecaoManualAtual, depoisHtml)
  destacarCorrecaoManualNaPagina(selecaoManualAtual, depoisHtml)
  if (feedback) {
    feedback.textContent = `Substituição registrada para o futuro arquivo corrigido. Total de correções: ${correcoesAplicadas.length}.`
  }
  renderSummary(ultimoResultado)
  selecaoManualAtual = null
}

function renderComentarioTextoSelecionado(dados) {
  return `
    <div class="comment-box manual-comment-box">
      <div class="correction-before">
        <strong>Trecho comentado</strong>
        <p>${dados.antesHtml || escHtml(dados.antes)}</p>
      </div>
      <label for="commentAuthor">Comentário no Word</label>
      <input id="commentAuthor" type="text" value="${escHtml(comentarioAutorPadrao)}" placeholder="Autor do comentário" />
      <textarea id="commentText" rows="5" placeholder="Escreva o comentário que deve aparecer no Word."></textarea>
      <div class="comment-actions">
        <button type="button" class="primary" data-action="apply-selection-comment">Adicionar comentário</button>
        <span>O comentário será inserido no DOCX corrigido, no trecho selecionado.</span>
      </div>
      <p class="comment-feedback" id="commentFeedback"></p>
    </div>
  `
}

function abrirModalComentarTextoSelecionado() {
  if (!importedDocxArrayBuffer) {
    alert('Importe um DOCX antes de registrar comentários para o Word.')
    return
  }
  const dados = selecaoAtualDoEditor({
    acao: 'Comentar texto selecionado',
    objeto: 'o comentário',
  })
  if (!dados) return
  comentarioManualAtual = dados
  selecaoManualAtual = null
  sourceModalOccurrenceId = null
  sourceModalItem = null
  if (sourceModalTitle) sourceModalTitle.textContent = 'Comentar texto selecionado'
  if (sourceModalCitation) sourceModalCitation.textContent = 'Comentário manual para o Word'
  sourceModalBody.innerHTML = renderComentarioTextoSelecionado(dados)
  sourceModal.classList.remove('hidden')
  setTimeout(() => sourceModalBody?.querySelector('#commentText')?.focus(), 0)
}

function registrarComentarioManualTexto(dados, autor, comentario) {
  comentariosAplicados.push({
    id: `comentario-manual-${Date.now()}-${comentariosAplicados.length + 1}`,
    tipo: 'texto',
    alvo: dados.antes,
    alvoHtml: dados.antesHtml,
    paragrafoAntes: dados.paragrafoAntes,
    autor,
    comentario,
    registradaEm: new Date().toISOString(),
  })
  window.refsComentariosAplicados = comentariosAplicados
  atualizarEstadoExportacao()
}

function destacarComentarioManualNaPagina(dados) {
  if (!dados?.range) return false
  try {
    const mark = document.createElement('span')
    mark.className = 'manual-comment-mark'
    mark.title = 'Comentário registrado para o DOCX corrigido'
    mark.appendChild(dados.range.extractContents())
    dados.range.insertNode(mark)
    editor.normalize()
    if (textSearchInput?.value) executarBuscaTexto(0, { navegar: false })
    return true
  } catch (err) {
    console.warn('Não foi possível destacar o comentário manual na página.', err)
    return false
  }
}

function aplicarComentarioSelecaoManual() {
  const authorInput = sourceModalBody?.querySelector('#commentAuthor')
  const commentInput = sourceModalBody?.querySelector('#commentText')
  const feedback = sourceModalBody?.querySelector('#commentFeedback')
  if (!comentarioManualAtual || !authorInput || !commentInput) return

  const autor = normalizarEspacos(authorInput.value || '') || 'ABeNiTa'
  const comentario = normalizarEspacos(commentInput.value || '')
  if (!comentario) {
    if (feedback) feedback.textContent = 'Digite o texto do comentário antes de adicionar.'
    return
  }

  comentarioAutorPadrao = autor
  registrarComentarioManualTexto(comentarioManualAtual, autor, comentario)
  destacarComentarioManualNaPagina(comentarioManualAtual)
  if (feedback) {
    feedback.textContent = `Comentário registrado para exportação. Total de comentários: ${comentariosAplicados.length}.`
  }
  comentarioManualAtual = null
}

function renderCorrecaoOcorrencia(item) {
  if (!ocorrenciaPodeSerCorrigida(item)) return ''
  const sugestao = sugerirCorrecaoOcorrencia(item)
  const htmlInicial = htmlInicialCorrecao(item, sugestao)
  const grupo = grupoCorrecaoGlobal(item)
  const opcoesEscopo = grupo.length > 1
    ? `
      <fieldset class="correction-scope">
        <legend>Escopo da correção</legend>
        <label>
          <input type="radio" name="correctionScope" value="single" checked />
          <span>Corrigir somente este caso</span>
        </label>
        <label>
          <input type="radio" name="correctionScope" value="sequence" />
          <span>${escHtml(labelCorrecaoGlobal(item, grupo.length))}</span>
        </label>
      </fieldset>
    `
    : ''
  const textoAnterior = ocorrenciaEhReferenciaLista(item)
    ? ''
    : `
      <div class="correction-before">
        <strong>Texto anterior</strong>
        <p>${htmlAnteriorOcorrencia(item)}</p>
      </div>
    `
  return `
    <div class="correction-box">
      ${textoAnterior}
      <label for="correctionText">Texto corrigido</label>
      <div class="correction-toolbar" aria-label="Formatação do texto corrigido">
        <button type="button" data-format-command="bold"><strong>B</strong></button>
        <button type="button" data-format-command="italic"><em>I</em></button>
      </div>
      <div id="correctionText" class="correction-editor" contenteditable="true" role="textbox" aria-multiline="true">${htmlInicial}</div>
      ${opcoesEscopo}
      <div class="correction-actions">
        <button type="button" class="primary" data-action="apply-correction">Aplicar correção</button>
        <span>O ABeNiTa vai conferir novamente essa ocorrência após aplicar.</span>
      </div>
      <p class="correction-feedback" id="correctionFeedback"></p>
    </div>
  `
}

function renderComentarioOcorrencia(item) {
  if (!ocorrenciaPodeSerCorrigida(item)) return ''
  return `
    <div class="comment-box">
      <label for="commentAuthor">Comentário no Word</label>
      <input id="commentAuthor" type="text" value="${escHtml(comentarioAutorPadrao)}" placeholder="Autor do comentário" />
      <textarea id="commentText" rows="3" placeholder="Escreva o comentário que deve aparecer no Word."></textarea>
      <div class="comment-actions">
        <button type="button" data-action="add-word-comment">Adicionar comentário</button>
        <span>O comentário será inserido no DOCX baixado, no local desta ocorrência.</span>
      </div>
      <p class="comment-feedback" id="commentFeedback"></p>
    </div>
  `
}

function relatorioErrosOcorrencia(item) {
  const erros = []
  ;(item?.resultados || []).forEach(resultado => {
    if (resultado.status === 'ok') return
    const trecho = resultado.unit?.raw || item.text || ''
    const detalhe = resultado.status === 'warning' && resultado.ref?.text
      ? `Ano divergente em "${trecho}". Referência vinculada: ${resultado.ref.text}`
      : `${textoStatus(resultado.status)}: ${trecho}`
    erros.push(detalhe)
  })

  ;(item?.issues || []).forEach(issue => erros.push(issue))
  return Array.from(new Set(erros.filter(Boolean)))
}

function renderRelatorioOcorrencia(item) {
  const erros = relatorioErrosOcorrencia(item)
  if (!erros.length) {
    return `
      <div class="source-report clean">
        <strong>Nenhum problema detectado 😎</strong>
      </div>
    `
  }
  const lista = erros.map(erro => `<li>${formatIssueHtml(erro)}</li>`).join('')
  return `
    <div class="source-report">
      <strong>Relatório da ocorrência</strong>
      <ul class="issue-list">${lista}</ul>
    </div>
  `
}

function htmlFonteReferencia(ref) {
  if (ref?.element?.isConnected) return sanitizarHtmlCorrecao(ref.element.innerHTML)
  return escHtml(ref?.text || 'Referência não encontrada na lista final.')
}

function renderFonteReferencia(item) {
  if (!item) return ''
  if (item.status === 'format' || item.referenceType === 'referencia-manual') {
    const tipo = ABNT_TIPOS[item.referenceType] || ABNT_TIPOS.desconhecido
    const referenciaHtml = item.element?.isConnected
      ? sanitizarHtmlCorrecao(item.element.innerHTML)
      : escHtml(item.referenceText || item.text)
    return `
      <div class="source-item ${item.status === 'format' ? 'format' : 'ok'}">
        <strong>${item.status === 'format' ? `${textoStatus(item.status)} — ${escHtml(tipo)}` : 'Referência'}</strong>
        <p>${referenciaHtml}</p>
      </div>
    `
  }

  return (item.resultados || []).map(resultado => {
    const refHtml = htmlFonteReferencia(resultado.ref)
    return `
      <div class="source-item ${resultado.status}">
        <strong>${escHtml(resultado.unit?.raw || item.text)} — ${textoStatus(resultado.status)}</strong>
        <p>${refHtml}</p>
      </div>
    `
  }).join('')
}

function renderSecaoModal(titulo, conteudo, classe) {
  if (!conteudo) return ''
  return `
    <section class="modal-section ${classe || ''}">
      <h3>${escHtml(titulo)}</h3>
      ${conteudo}
    </section>
  `
}

function itemRelatorioCitacao(item) {
  const base = ocorrenciaBaseDaCitacao(item)
  const issues = Array.from(new Set([...(base?.issues || []), ...(item?.issues || [])]))
  return { ...base, issues }
}

function renderModalCitacao(item) {
  const base = ocorrenciaBaseDaCitacao(item)
  const relatorioItem = itemRelatorioCitacao(item)
  const blocoCitacao = renderRelatorioOcorrencia(relatorioItem) + renderCorrecaoOcorrencia(item) + renderComentarioOcorrencia(item)
  const fontes = renderFonteReferencia(base)
  return blocoCitacao
    + renderSecaoModal('Fontes da referência', fontes, 'sources-section')
}

function renderModalReferenciaLista(item) {
  return renderRelatorioOcorrencia(item) + renderFonteReferencia(item) + renderCorrecaoOcorrencia(item) + renderComentarioOcorrencia(item)
}

function abrirModalItem(item) {
  if (!item || !sourceModal) return
  sourceModalOccurrenceId = item.id
  sourceModalItem = item
  if (sourceModalTitle) sourceModalTitle.textContent = ocorrenciaEhCitacao(item) ? 'Citação' : 'Fonte da referência'
  sourceModalCitation.textContent = item.text || ''
  sourceModalBody.innerHTML = ocorrenciaEhCitacao(item)
    ? renderModalCitacao(item)
    : renderModalReferenciaLista(item)
  sourceModal.classList.remove('hidden')
}

function abrirModalFonte(id) {
  abrirModalItem(occurrences.find(o => o.id === id))
}

function criarOcorrenciaManualReferencia(ref) {
  const existente = occurrences.find(item => item.element === ref.element && item.status === 'format')
  if (existente) return existente
  return {
    id: `manual-ref-${ref.index}-${Date.now()}`,
    text: ref.text,
    status: 'ok',
    resultados: [],
    referenceText: ref.text,
    referenceType: 'referencia-manual',
    autoriaSubstituta: ref.autoriaSubstituta || '',
    autoriaGrupoCorrecao: ref.autoriaGrupoCorrecao || '',
    anoEsperado: ref.anoEsperado || '',
    anoBaseDuplicado: ref.anoBaseDuplicado || '',
    anoGrupoCorrecao: ref.anoGrupoCorrecao || '',
    issues: [],
    element: ref.element,
  }
}

function fecharModalFonte() {
  sourceModalOccurrenceId = null
  sourceModalItem = null
  selecaoManualAtual = null
  comentarioManualAtual = null
  sourceModal?.classList.add('hidden')
}

function blocoDaOcorrencia(item) {
  return item?.element?.closest?.('p, li, h1, h2, h3, h4, h5, h6') || item?.element || null
}

function ocorrenciasRelacionadasAoTexto(text, bloco) {
  const chave = normalizarTexto(text)
  if (!chave) return []
  return occurrences.filter(item => {
    if (bloco && blocoDaOcorrencia(item) !== bloco) return false
    const textos = [item.text, item.referenceText, textoAtualOcorrencia(item)].filter(Boolean)
    return textos.some(valor => normalizarTexto(valor) === chave)
  })
}

function validarCorrecaoAplicada(originalItem, textoCorrigido, bloco) {
  const relacionados = ocorrenciasRelacionadasAoTexto(textoCorrigido, bloco)
  if (ocorrenciaEhCitacao(originalItem)) {
    const marcacaoOk = relacionados.some(item => item.status === 'ok')
    const pendencias = relacionados.filter(item => item.status !== 'ok')
    return {
      corrigida: marcacaoOk && pendencias.length === 0,
      relacionados,
      pendencias,
    }
  }

  const pendencias = relacionados.filter(item => item.status === 'format')
  return {
    corrigida: pendencias.length === 0,
    relacionados,
    pendencias,
  }
}

function registrarCorrecaoValidada(item, antes, depois, antesHtml, depoisHtml, paragrafoAntes = '') {
  const bloco = blocoDaOcorrencia(item)
  correcoesAplicadas.push({
    id: `correcao-${Date.now()}-${correcoesAplicadas.length + 1}`,
    tipo: ocorrenciaEhCitacao(item) ? 'citacao' : 'referencia',
    antes,
    depois,
    antesHtml,
    depoisHtml,
    paragrafoAntes: paragrafoAntes || (bloco ? textoBloco(bloco) : ''),
    registradaEm: new Date().toISOString(),
  })
  window.refsCorrecoesAplicadas = correcoesAplicadas
  atualizarEstadoExportacao()
}

function registrarComentarioWord(item, autor, comentario) {
  const alvo = textoAtualOcorrencia(item)
  const alvoHtml = htmlAnteriorOcorrencia(item)
  const bloco = blocoDaOcorrencia(item)
  comentariosAplicados.push({
    id: `comentario-${Date.now()}-${comentariosAplicados.length + 1}`,
    tipo: ocorrenciaEhCitacao(item) ? 'citacao' : 'referencia',
    alvo,
    alvoHtml,
    paragrafoAntes: bloco ? textoBloco(bloco) : '',
    autor,
    comentario,
    registradaEm: new Date().toISOString(),
  })
  window.refsComentariosAplicados = comentariosAplicados
  atualizarEstadoExportacao()
}

function formatarPendenciasCorrecao(pendencias) {
  return pendencias.map(item => {
    if (item.status === 'format' && item.issues?.length) {
      return `${textoStatus(item.status)}: ${item.issues.join(' | ')}`
    }
    return textoStatus(item.status)
  }).join('\n')
}

function adicionarComentarioOcorrencia() {
  const item = occurrences.find(o => o.id === sourceModalOccurrenceId) || sourceModalItem
  const authorInput = sourceModalBody?.querySelector('#commentAuthor')
  const commentInput = sourceModalBody?.querySelector('#commentText')
  const feedback = sourceModalBody?.querySelector('#commentFeedback')
  if (!item || !authorInput || !commentInput || !ocorrenciaPodeSerCorrigida(item)) return

  const autor = normalizarEspacos(authorInput.value || '') || 'ABeNiTa'
  const comentario = normalizarEspacos(commentInput.value || '')
  if (!comentario) {
    if (feedback) feedback.textContent = 'Digite o texto do comentário antes de adicionar.'
    return
  }

  comentarioAutorPadrao = autor
  registrarComentarioWord(item, autor, comentario)
  commentInput.value = ''
  if (feedback) feedback.textContent = `Comentário registrado para exportação. Total de comentários: ${comentariosAplicados.length}.`
}

function formatarSelecaoCorrecao(command) {
  const editorCorrecao = sourceModalBody?.querySelector('#correctionText')
  if (!editorCorrecao) return
  editorCorrecao.focus()
  document.execCommand(command, false, null)
}

function textoDeHtmlCorrecao(html) {
  const template = document.createElement('template')
  template.innerHTML = sanitizarHtmlCorrecao(html)
  return normalizarEspacos(template.content.textContent || '')
}

function htmlSugestaoAutomatica(item) {
  return htmlInicialCorrecao(item, sugerirCorrecaoOcorrencia(item))
}

function montarMudancaCorrecao(item, depoisHtml) {
  if (!item?.element?.isConnected) return null
  const bloco = blocoDaOcorrencia(item)
  const antes = textoAtualOcorrencia(item)
  const antesHtml = sanitizarHtmlCorrecao(item.element.innerHTML)
  const htmlFinal = sanitizarHtmlCorrecao(depoisHtml)
  const depois = textoDeHtmlCorrecao(htmlFinal)
  if (!normalizarEspacos(depois)) return null
  if (antes === depois && antesHtml === htmlFinal) return null
  return {
    item,
    antes,
    depois,
    antesHtml,
    depoisHtml: htmlFinal,
    bloco,
    paragrafoAntes: bloco ? textoBloco(bloco) : '',
  }
}

function mudancasCorrecaoSequencia(item, editorHtml) {
  const escopo = sourceModalBody?.querySelector('input[name="correctionScope"]:checked')?.value || 'single'
  if (escopo !== 'sequence') {
    return [montarMudancaCorrecao(item, editorHtml)].filter(Boolean)
  }

  return grupoCorrecaoGlobal(item).map(ocorrencia => {
    const html = ocorrencia.id === item.id
      ? editorHtml
      : htmlSugestaoAutomatica(ocorrencia)
    return montarMudancaCorrecao(ocorrencia, html)
  }).filter(Boolean)
}

function aplicarCorrecaoOcorrencia() {
  const item = occurrences.find(o => o.id === sourceModalOccurrenceId) || sourceModalItem
  const editorCorrecao = sourceModalBody?.querySelector('#correctionText')
  const feedback = sourceModalBody?.querySelector('#correctionFeedback')
  if (!item || !editorCorrecao || !ocorrenciaPodeSerCorrigida(item)) return

  const editorHtml = sanitizarHtmlCorrecao(editorCorrecao.innerHTML)
  const textoEditor = textoDeHtmlCorrecao(editorHtml)
  if (!normalizarEspacos(textoEditor)) {
    if (feedback) feedback.textContent = 'Informe o texto corrigido antes de aplicar.'
    return
  }
  const mudancas = mudancasCorrecaoSequencia(item, editorHtml)
  if (!mudancas.length) {
    if (feedback) feedback.textContent = 'O texto corrigido está igual ao texto atual.'
    return
  }

  mudancas.forEach(mudanca => {
    mudanca.item.element.innerHTML = mudanca.depoisHtml
  })
  conferirReferencias()

  const validacoes = mudancas.map(mudanca => ({
    mudanca,
    validacao: validarCorrecaoAplicada(mudanca.item, mudanca.depois, mudanca.bloco),
  }))
  const corrigidas = validacoes.filter(resultado => resultado.validacao.corrigida)
  corrigidas.forEach(({ mudanca }) => {
    registrarCorrecaoValidada(
      mudanca.item,
      mudanca.antes,
      mudanca.depois,
      mudanca.antesHtml,
      mudanca.depoisHtml,
      mudanca.paragrafoAntes,
    )
  })

  if (corrigidas.length === mudancas.length) {
    renderSummary(ultimoResultado)
    const primeiroResultado = validacoes[0]
    const novoItem = primeiroResultado?.validacao.relacionados.find(o => o.status === 'ok')
      || primeiroResultado?.validacao.relacionados[0]
    if (novoItem) {
      focusOccurrence(novoItem.id)
      abrirModalFonte(novoItem.id)
      const novoFeedback = sourceModalBody?.querySelector('#correctionFeedback')
      if (novoFeedback) {
        novoFeedback.textContent = mudancas.length > 1
          ? `Sequência corrigida e registrada para o futuro arquivo corrigido (${mudancas.length} referências).`
          : 'Correção validada e registrada para o futuro arquivo corrigido.'
      }
    } else {
      fecharModalFonte()
      dropZone.textContent = mudancas.length > 1
        ? `Sequência corrigida e registrada para o futuro arquivo corrigido (${mudancas.length} referências).`
        : 'Correção validada e registrada para o futuro arquivo corrigido.'
    }
    return
  }

  const pendencias = validacoes.flatMap(resultado => resultado.validacao.pendencias)
  const pendenciasTexto = formatarPendenciasCorrecao(pendencias)
  const primeiroPendente = validacoes.find(resultado => !resultado.validacao.corrigida)
  const novoItem = primeiroPendente?.validacao.relacionados[0]
  if (novoItem) abrirModalFonte(novoItem.id)
  const novoFeedback = sourceModalBody?.querySelector('#correctionFeedback')
  if (novoFeedback) {
    novoFeedback.textContent = pendenciasTexto
      ? `A correção foi aplicada, mas ainda há pendências:\n${pendenciasTexto}`
      : 'A correção foi aplicada, mas a ocorrência não foi reconhecida como totalmente resolvida.'
  }
}

function ocultarImagensDoEditor() {
  editor.querySelectorAll('img, svg, picture').forEach(el => el.remove())
}

async function importDocx(file) {
  if (!file) return
  limparCorrecoesAplicadas()
  stripMarks()
  chapterScopes = []
  activeChapterIndex = -1
  editor.querySelectorAll('.chapter-title-block').forEach(el => el.classList.remove('chapter-title-block'))
  renderChapterNav()
  dropZone.textContent = `Importando ${file.name}...`
  const arrayBuffer = await file.arrayBuffer()
  importedDocxArrayBuffer = arrayBuffer.slice(0)
  importedDocxName = file.name
  atualizarEstadoExportacao()
  let estruturaDocx = null
  if (window.refsBridge && typeof window.refsBridge.extrairEstruturaDocx === 'function') {
    try {
      estruturaDocx = await window.refsBridge.extrairEstruturaDocx({ arrayBuffer: arrayBuffer.slice(0) })
    } catch (err) {
      console.warn('Não foi possível extrair estilos do DOCX.', err)
    }
  }
  const result = await window.mammoth.convertToHtml({ arrayBuffer }, {
    convertImage: () => Promise.resolve([]),
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "b => strong",
      "i => em",
    ],
  })
  editor.innerHTML = result.value || '<p></p>'
  ocultarImagensDoEditor()
  anexarMetadadosParagrafos(estruturaDocx?.paragraphs || [])
  const refsElegiveis = encontrarSecoesReferenciasElegiveis()
  if (refsElegiveis.length > 1 && docxParagraphMeta.length) {
    const styles = estilosDisponiveisParaCapitulos()
    if (styles.length) {
      dropZone.innerHTML = `<strong>${escHtml(file.name)}</strong> importado. Escolha o estilo dos títulos principais para dividir o documento.`
      abrirPainelEscolhaCapitulos(styles)
      return
    }
  }
  conferirReferencias()
  dropZone.innerHTML = `<strong>${escHtml(file.name)}</strong> importado. Conferencia executada automaticamente.`
}

async function exportarDocxCorrigido() {
  if (!importedDocxArrayBuffer) {
    alert('Importe um DOCX antes de baixar o arquivo corrigido.')
    return
  }
  if (!correcoesAplicadas.length && !comentariosAplicados.length) {
    alert('Ainda não há correções ou comentários para aplicar.')
    return
  }
  if (!window.refsBridge?.exportarDocxCorrigido) {
    alert('A exportação do DOCX corrigido está disponível no app desktop do ABeNiTa.')
    return
  }

  exportCorrectedBtn.disabled = true
  exportCorrectedBtn.textContent = 'Gerando...'
  try {
    const result = await window.refsBridge.exportarDocxCorrigido({
      fileName: importedDocxName || 'abenita.docx',
      arrayBuffer: importedDocxArrayBuffer,
      correcoes: correcoesAplicadas,
      comentarios: comentariosAplicados,
    })
    if (result?.cancelado) return
    if (!result?.ok) {
      alert(result?.erro || 'Não foi possível gerar o DOCX corrigido.')
      return
    }
    const ignoradas = Array.isArray(result.ignoradas) ? result.ignoradas.length : 0
    dropZone.textContent = `DOCX corrigido salvo. Correções aplicadas: ${result.aplicadas || 0}; comentários inseridos: ${result.comentariosInseridos || 0}${ignoradas ? `; não encontradas: ${ignoradas}` : ''}.`
    if (ignoradas) {
      alert(`DOCX salvo, mas ${ignoradas} item(ns) não foram encontrados no arquivo original. O restante foi aplicado sem alterar outras áreas.`)
    }
  } catch (err) {
    console.error(err)
    alert(`Não foi possível gerar o DOCX corrigido: ${err.message || err}`)
  } finally {
    exportCorrectedBtn.textContent = 'Baixar DOCX corrigido'
    atualizarEstadoExportacao()
  }
}

docxInput.addEventListener('change', event => {
  const file = event.target.files?.[0]
  importDocx(file).catch(err => {
    console.error(err)
    alert(`Não foi possível importar o DOCX: ${err.message}`)
  })
})

runBtn.addEventListener('click', conferirReferencias)
manualReplaceBtn?.addEventListener('click', abrirModalAlterarTextoSelecionado)
manualCommentBtn?.addEventListener('click', abrirModalComentarTextoSelecionado)
exportCorrectedBtn?.addEventListener('click', exportarDocxCorrigido)
clearBtn.addEventListener('click', () => {
  limparCorrecoesAplicadas()
  stripMarks()
})
validateUrlsBtn?.addEventListener('click', validarUrlsReferencias)
chapterStyleSelect?.addEventListener('change', atualizarPreviewEstiloCapitulo)
chapterSetupContinue?.addEventListener('click', continuarComCapitulos)
chapterSetupSingle?.addEventListener('click', usarDocumentoUnico)
chapterNav?.addEventListener('click', event => {
  const btn = event.target.closest('button[data-chapter-index]')
  if (!btn) return
  ativarCapitulo(Number(btn.dataset.chapterIndex))
})
textSearchInput?.addEventListener('input', () => executarBuscaTexto(0, { navegar: false }))
textSearchInput?.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (!buscaTextoMatches.length) executarBuscaTexto(0, { navegar: true })
  navegarBuscaTexto(event.shiftKey ? -1 : 1)
})
textSearchCaseBtn?.addEventListener('click', () => {
  buscaTextoDiferenciarCaixa = !buscaTextoDiferenciarCaixa
  textSearchCaseBtn.classList.toggle('active', buscaTextoDiferenciarCaixa)
  textSearchCaseBtn.setAttribute(
    'aria-pressed',
    buscaTextoDiferenciarCaixa ? 'true' : 'false',
  )
  executarBuscaTexto(Math.max(buscaTextoIndiceAtivo, 0), { navegar: false })
  textSearchInput?.focus()
})
textSearchPrevBtn?.addEventListener('click', () => navegarBuscaTexto(-1))
textSearchNextBtn?.addEventListener('click', () => navegarBuscaTexto(1))

pasteModeBtn.addEventListener('click', async () => {
  limparCorrecoesAplicadas()
  stripMarks()
  importedDocxArrayBuffer = null
  importedDocxName = ''
  atualizarEstadoExportacao()
  const text = await navigator.clipboard.readText().catch(() => '')
  if (text) {
    editor.innerHTML = normalizarParagrafoHtml(text)
    if (textSearchInput?.value) executarBuscaTexto(0, { navegar: false })
    dropZone.textContent = 'Texto colado. Clique em Conferir referências.'
  } else {
    alert('Não consegui ler a área de transferência. Importe um DOCX ou copie o texto novamente e use o botão Colar texto.')
  }
})

filtersEl.addEventListener('click', event => {
  const btn = event.target.closest('[data-filter]')
  if (!btn) return
  activeFilter = btn.dataset.filter
  renderFilters()
  renderOccurrences()
})

occurrencesEl.addEventListener('click', event => {
  const btn = event.target.closest('[data-id]')
  if (!btn) return
  focusOccurrence(btn.dataset.id)
})

referencesListEl?.addEventListener('click', event => {
  const citeBtn = event.target.closest('[data-cite-id]')
  if (citeBtn) {
    focusOccurrence(citeBtn.dataset.citeId)
    return
  }

  const btn = event.target.closest('[data-ref-index]')
  if (!btn || !ultimoResultado?.referencias) return
  const ref = ultimoResultado.referencias[Number(btn.dataset.refIndex)]
  if (!ref?.element?.isConnected) return

  document.querySelectorAll('.reference-item.active').forEach(el => el.classList.remove('active'))
  btn.closest('.reference-item')?.classList.add('active')
  ref.element.scrollIntoView({ behavior: 'smooth', block: 'center' })

  const range = document.createRange()
  range.selectNodeContents(ref.element)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
})

editor.addEventListener('click', event => {
  const mark = event.target.closest('.ref-mark, .ref-format, .ref-list-entry')
  if (!mark) return
  if (mark.classList.contains('ref-mark') || mark.classList.contains('ref-format')) {
    focusOccurrence(mark.dataset.occurrenceId)
    abrirModalFonte(mark.dataset.occurrenceId)
    return
  }

  const refIndex = Number(mark.dataset.refIndex)
  const ref = ultimoResultado?.referencias?.find(item => item.index === refIndex)
  if (!ref?.element?.isConnected) return

  document.querySelectorAll('.ref-mark.active, .ref-format.active, .ref-list-entry.active').forEach(el => el.classList.remove('active'))
  ref.element.classList.add('active')
  const range = document.createRange()
  range.selectNodeContents(ref.element)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  abrirModalItem(criarOcorrenciaManualReferencia(ref))
})

sourceModalClose?.addEventListener('click', fecharModalFonte)
sourceModalBody?.addEventListener('mousedown', event => {
  if (event.target.closest('[data-format-command]')) event.preventDefault()
})
sourceModalBody?.addEventListener('click', event => {
  const formatBtn = event.target.closest('[data-format-command]')
  if (formatBtn) {
    formatarSelecaoCorrecao(formatBtn.dataset.formatCommand)
    return
  }
  if (event.target.closest('[data-action="add-word-comment"]')) {
    adicionarComentarioOcorrencia()
    return
  }
  if (event.target.closest('[data-action="apply-selection-correction"]')) {
    aplicarCorrecaoSelecaoManual()
    return
  }
  if (event.target.closest('[data-action="apply-selection-comment"]')) {
    aplicarComentarioSelecaoManual()
    return
  }
  if (event.target.closest('[data-action="apply-correction"]')) aplicarCorrecaoOcorrencia()
})
sourceModal?.addEventListener('click', event => {
  if (event.target.closest('[data-source-close]')) fecharModalFonte()
})
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    textSearchInput?.focus()
    textSearchInput?.select()
    return
  }
  if (event.key === 'Escape' && !sourceModal?.classList.contains('hidden')) {
    fecharModalFonte()
  }
})

dropZone.addEventListener('dragover', event => {
  event.preventDefault()
  dropZone.classList.add('dragover')
})

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover')
})

dropZone.addEventListener('drop', event => {
  event.preventDefault()
  dropZone.classList.remove('dragover')
  const file = Array.from(event.dataTransfer.files || []).find(f => /\.docx$/i.test(f.name))
  if (file) importDocx(file)
})

renderFilters()
renderOccurrences()
atualizarEstadoExportacao()
textSearchCaseBtn?.setAttribute('aria-pressed', 'false')
atualizarContadorBuscaTexto()
