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

## Pendências de desenvolvimento (lembrete obrigatório)

O sistema tem uma tela própria de backlog em `desenvolvimento/` (coleção Firestore `desenvolvimento`, campos `texto`/`status`/`criadoEm`/`concluidoEm`/`notaConclusao`) — é a lista de pendências que o João vai preenchendo com o que quer que seja mudado no sistema.

**No início de qualquer conversa cujo assunto seja o Sistema GW**, consulte essa coleção (via Firestore REST, com `gcloud config set account joao.ibira@gmail.com` antes) e veja se há itens com `status: "aberto"`. Se houver, avise o João logo no começo da conversa (não espere ele perguntar) e pergunte se quer resolver algum agora. Ao concluir um item, marque com `status: "concluido"`, `concluidoEm` e um `notaConclusao` curto descrevendo o que foi feito e a versão — mesmo padrão já usado no Obsidian (`03 - Nosso/Sistemas - Pendencias/2026-08-07 - Pendências Green Wall.md`), que continua existindo em paralelo (o João pode usar qualquer um dos dois).
