# 🌙 Luna — Avatar de anime

Página **estática** (HTML + CSS + JS, sem framework e sem build no deploy) que
abre um avatar VRM 3D no navegador do celular. Você escreve, a Luna responde
com IA, fala em voz alta com a voz do sistema, mexe a boca no ritmo da fala,
pisca, muda de expressão e acompanha o seu dedo com o olhar.

```
index.html          página: layout, painel de configurações e visual
app.bundle.js       JavaScript empacotado (three.js + @pixiv/three-vrm + app)
assets/avatar.vrm   modelo VRM 1.0 (10 MB)
LEIA-ME.txt         instruções curtas de publicação e uso
vercel.json         cabeçalhos do deploy (tipo e cache do .vrm)
src/main.js         fonte do app (não é necessário para publicar)
dev/                ambiente de desenvolvimento e renderizador de teste
```

## Publicar na Vercel

1. Envie os arquivos para a raiz do repositório **preservando `assets/avatar.vrm`**.
2. Na Vercel: **Add New → Project** e importe o repositório.
3. **Framework Preset: Other** • **Root Directory: `./`** • **Build Command: vazio**.
4. **Deploy**. Não há variáveis de ambiente, servidor nem banco de dados.

## Como funciona

| Recurso | Como é feito |
|---|---|
| Avatar 3D | VRM 1.0 carregado com `@pixiv/three-vrm` + `three.js` |
| Conversa | API da Groq (`chat/completions`), chamada direto do navegador |
| Voz | `speechSynthesis` do navegador (vozes em português, quando disponíveis) |
| Boca falando | pesos das expressões `aa`/`ih` animados no ritmo da fala |
| Emoções | `happy`, `sad`, `angry`, `surprised`, `relaxed` + botões de emoji |
| Olhar | `VRMLookAtBoneApplier` seguindo o toque na tela |
| Câmera | `OrbitControls`: arrastar gira, pinça dá zoom, 🎯 volta ao enquadramento |
| Chave da API | salva no `localStorage` deste navegador (nunca sai do aparelho) |

O avatar carrega **independentemente** da Groq: sem chave, ele aparece e a voz
funciona, só as respostas viram falas prontas.

## Desenvolvimento

```bash
cd dev
node render.mjs --view bust --out /tmp/preview.png   # renderiza o avatar em PNG (sem GPU)
```

Para mudar o app, edite `src/main.js` e gere o bundle:

```bash
cd dev
cp ../src/main.js build/entry.js
npx esbuild build/entry.js --bundle --minify --format=iife --target=es2019 --outfile=../app.bundle.js
```

## Limitações

- A chave da Groq fica no front-end. Para oferecer o projeto a outras pessoas,
  crie uma função serverless (Vercel) que guarde a chave e faça a chamada no
  lugar do navegador.
- A voz depende das vozes instaladas no aparelho; o timbre varia por sistema.
- Não há detecção de fala do usuário (sem microfone) nem animação de corpo
  inteiro: a pose é uma animação leve de respiração e balanço.
- Celulares com pouca memória/WebGL antigo podem não abrir o modelo.

## Créditos e licenças

- Avatar: **“VRM1_Constraint_Twist_Sample” © 2022 pixiv Inc.** — Licença
  [VRM Public License 1.0](https://vrm.dev/licenses/1.0/) (redistribuição e
  modificação permitidas). Os metadados de licença estão dentro do próprio
  `assets/avatar.vrm`.
- [three.js](https://threejs.org/) e [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) — MIT.
