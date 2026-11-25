# One Map

Mapa 3D do mundo de One Piece em que o navio navega até o episódio em que você está, com os
links do One Pace, os episódios do anime e os capítulos do mangá de cada ilha.

As decisões de design estão em [docs/DECISOES.md](docs/DECISOES.md).

## Rodar

```sh
npm install
npm run dev
```

Parâmetros de URL úteis em desenvolvimento:

- `?quality=low` ou `?quality=high` força o nível de qualidade (por padrão é detectado: tablet/celular usam `low`)
- `?at=330,1020&dist=22` posiciona a câmera num pixel do **mapa já cortado** (4096×2085), com a
  distância indicada. Pixel da referência original → mapa: `x_mapa = (x_ref - 1763) mod 4096`.

## Pipeline do mapa

```
reference/world-map-xads181.jpeg       → Red Line, Reverse Mountain, Calm Belts e ilhas-base
reference/regions/*.png                → prints detalhados de cada região (verdade das ilhas)
   │  npm run geo:align     (só quando trocar um print: acha escala/posição de cada um → align.json)
   │  npm run geo:extract   (extrai a referência → geography.extracted.json; depois troca as ilhas
   │                         de cada região pelas dos prints → geography.json + colors.png)
   ▼
geo/geography.json          ← fonte de verdade da geografia (pode ser editada)
   │  npm run geo:terrain   (rasteriza, gera platôs, biomas, Reverse Mountain, normal e cor)
   ▼
public/terrain/*            texturas usadas pela cena
src/data/terrain-meta.json  tamanho do mundo e codificação da altura
```

Depois de editar `geo/geography.json` à mão, rode **só** `geo:terrain`. Rodar `geo:extract`
de novo sobrescreve as edições.

## Estrutura

- `src/`: o site (React + React Three Fiber)
- `src/world/`: a cena 3D (terreno, oceano, câmera)
- `src/data/`: JSONs de episódios, locais, rota e metadados do terreno
- `geo/`: geografia vetorial (contornos de ilhas e Red Line)
- `public/terrain/`: texturas geradas do terreno
- `scripts/`: scripts Node que extraem os contornos e montam os dados
- `reference/`: imagens de referência (mapa do xads181)
- `docs/`: decisões e notas
