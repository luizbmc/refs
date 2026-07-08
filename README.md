# ABeNiTa

Aplicativo independente para conferencia de citacoes autor-data, lista final de referencias e checagem ABNT.

Este repositorio nao depende do Normando/Legislator.

## Estrutura

```text
app/
  index.html
  app.js
  styles.css
  vendor/
    mammoth.browser.min.js
electron/
  main.js
  preload.js
package.json
```

O diretorio `app/` e a fonte unica da interface e da logica principal. A versao desktop carrega esses mesmos arquivos via Electron.

## Rodar como app web local

Abra:

```text
app/index.html
```

ou:

```text
index.html
```

## Rodar como app desktop em desenvolvimento

```powershell
npm install
npm run dev
```

## Gerar instalador Windows

```powershell
npm run release:win
```

O instalador sera gerado em `dist/`.

## Ponte desktop

No Electron, a interface tem acesso a:

```js
window.refsBridge.validarUrls(urls)
window.refsBridge.exportarDocxCorrigido(payload)
```

Essas funcoes rodam pelo processo Node local, sem depender de servidor central e com menos limitacoes de CORS.
