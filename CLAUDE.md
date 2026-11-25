# One Map

Site pessoal em 3D com o mapa de One Piece; o navio navega até o episódio em que o usuário está.

**Antes de começar, leia [docs/PROJETO.md](docs/PROJETO.md)** (ideia, onde estamos, próximos passos)
e, para detalhes de uma decisão, [docs/DECISOES.md](docs/DECISOES.md). Ao fechar uma etapa, atualize
o PROJETO.md (seções "Onde estamos", "Problemas conhecidos" e "Próximos passos").

- Conversa e textos em português (PT-BR).
- Visual: cartoon (platôs, cores chapadas, contornos); nada semi-realista.
- O mapa é gerado por scripts: edite `scripts/` e regenere (`npm run geo:extract`, `npm run geo:terrain`);
  não edite à mão `public/terrain/*` nem `src/data/terrain-meta.json`.
- Para conferir mudanças visuais: `npm run build`, `npx vite preview --port 4173` e screenshot com o
  Edge headless (`--use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=20000`),
  usando `?at=x,y&dist=n` para posicionar a câmera.
