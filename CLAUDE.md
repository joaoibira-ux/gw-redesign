# Sistema GW — Regras para o Claude

## Versão obrigatória a cada alteração

A cada modificação em qualquer arquivo deste sistema:

1. **Atualizar a versão** em `index.html` (constante `VERSAO` na linha ~308) — ex: `'3.77'`
2. **Atualizar o service worker** em `sw.js` (constante `VERSION`) para `"gw-redesign-vX.XX"` com o mesmo número — ex: `"gw-redesign-v3.77"`
3. **Commitar e fazer push** das alterações (sempre incluir `sw.js` e `index.html` no commit)
4. **Informar ao usuário** a nova versão no final da resposta: `Versão na tela do PIN: vX.XX`

A versão atual está em `index.html`: `const VERSAO = 'X.XX';`
A versão do SW está em `sw.js`: `const VERSION = "gw-redesign-vX.XX";`

## Regras gerais

- Sempre commit + push após qualquer mudança, sem perguntar
- O link "voltar ao menu" aponta para `https://sistema.gwrevestimentos.com.br/`
- Firebase project: `sistema-gw-36566`
- GitHub repo: `joaoibira-ux/gw-redesign`
