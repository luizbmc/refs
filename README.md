# Refs

Aplicativo independente para conferência de citações autor-data, lista final de referências e checagem ABNT.

Este repositório não depende do Normando/Legislator.

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

O diretório `app/` é a fonte única da interface e da lógica principal. A versão desktop carrega esses mesmos arquivos via Electron.

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
npm run package:win
```

O instalador será gerado em `dist/`.

## Ponte desktop

No Electron, a interface tem acesso a:

```js
window.refsBridge.validarUrls(urls)
```

Essa função valida URLs pelo processo Node local, sem depender de servidor central e com menos limitações de CORS.

