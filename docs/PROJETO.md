# One Map: visão do projeto

Atualizado em 25/11/2026. Versão viva no claude.ai: https://claude.ai/artifact/SmgzNLyAsuurPYK3GRSd7w
(mantenha as duas em sincronia ao fechar uma etapa).

## A ideia

O One Map é um site pessoal em 3D com o mapa do mundo de One Piece: o navio do Luffy navega até a
ilha do episódio em que você está, e cada ilha lista os episódios do anime, os capítulos do mangá e
os links do [One Pace](https://onepace.net).

O One Pace corta o anime para seguir o mangá, mas a lista dele é só uma sequência de episódios para
assistir ou baixar. O One Map transforma essa lista numa viagem: você vê onde está na história e
acompanha o bando de ilha em ilha.

- Uso pessoal; nenhum vídeo é hospedado, só links.
- O episódio do anime é a unidade de navegação (~1150), com o episódio do One Pace correspondente
  quando existir.

## Como vai funcionar

| Parte | Como funciona |
| --- | --- |
| Barra de episódios | `< Arco · Ep N >` no topo; setas avançam/voltam; clicar no nome abre a lista completa |
| Animação | Navio segue a rota (ida ou volta); barra travada durante a viagem; ~2–3 s padrão, viagens longas aceleram até ~6–8 s, câmera se afasta |
| Progresso | Episódio selecionado = onde você está; salvo no localStorage no início da animação; sync manual (exportar/importar, link `?ep=405`) |
| Episódios | Base no anime; link do One Pace quando existe, senão aviso "ainda não tem no One Pace"; tags Filler e Recap |
| Ilhas | Unidade do mapa = local (um arco pode passar por vários); ao chegar, zoom para a versão detalhada da ilha |
| Navio | Bote → Going Merry → Thousand Sunny conforme o episódio; peça de tabuleiro parada, encolhe ao navegar |
| Idiomas | Dropdown PT-BR / EN; conteúdo em inglês das fontes, traduzido pelo Claude |
| Dispositivos | Desktop completo; tablet/celular com a mesma cena em qualidade reduzida |

## Decisões de design

Resumo; a lista completa e o porquê estão em [DECISOES.md](DECISOES.md).

- **Estilo cartoon:** ilhas em platôs como papel recortado, cores chapadas por bioma, contorno
  escuro, toon shading. A versão semi-realista foi descartada.
- **Layout da referência:** Red Line de Mary Geoise nas duas bordas, Reverse Mountain no centro. O
  mapa não se repete; a rota cruza a borda na Ilha dos Tritões (navio passa por baixo da Red Line).
- **Geometria a partir de contornos:** cada platô é extrudado do contorno vetorial. A grade
  deformada por imagem foi abandonada porque serrilhava.
- **Red Line vermelho-carmim e montanhosa**, em degraus; continua além da borda e some numa névoa
  cinza-azulada.
- **Reverse Mountain:** pico em platôs na paleta da Red Line, 4 canais subindo até uma piscina no
  topo, 1 descendo em 5 cachoeiras.
- **Escala:** posições 2× espaçadas, ilhas 1,25×; as pequenas crescem até ~4 unidades (máx. 3×)
  sem encostar nas vizinhas nem na Red Line.
- **Ilhas vêm dos prints do usuário** (6 regiões); o xads181 dá Red Line, Reverse Mountain e Calm Belts.
- **Câmera:** inclinação acompanha o zoom (~62° perto, ~22° no máximo); zoom de 40 a 173.
- **Minimapa** 400×203 px no canto inferior esquerdo, retângulo de localização; transparente parado.
- **Navio:** peça de tabuleiro parado (~2,2 unidades); navegando encolhe para 45%, com tamanho
  mínimo na tela. Feito como o terreno (camadas, topo claro/parede escura, contorno, toon).
  Deixa um rastro na água no estilo da costa (água rasa + espuma recortada).

## Onde estamos

Versão 1 (tag `v1.0.0`) + protótipo do navio: um bote provisório faz Foosha → Shells Town →
Orange Town em vai e volta, parando em cada porto, com a câmera acompanhando. Ainda sem episódios.

| Área | Estado |
| --- | --- |
| Mapa 3D | Pronto |
| Câmera | Pronta |
| Minimapa | Pronto |
| Qualidade móvel | Detecção automática; não testado num tablet real |
| Pipeline de geografia | Pronto (`scripts/`) |
| Rota do navio | Protótipo: 3 locais do East Blue (`geo/places.json` → `scripts/build-route.mjs`) |
| Navio | Bote provisório (`src/world/Ship.tsx`) no estilo do terreno; acelera/freia, balança nas ondas, encolhe navegando, deixa rastro na água (`Trail.ts`) |
| Dados de episódios | Não começado |
| Barra de episódios / lista | Não começado |
| Zoom detalhado de ilha | Não começado |
| Idiomas | Não começado |
| Hospedagem | Repo privado; GitHub Pages pendente (Pro ou repo público) |

## Problemas conhecidos

- **Ilhas minúsculas** (< 8 px no print) seguem pequenas: o crescimento tem teto de 3×; 88 ilhas
  ficam abaixo de 4 unidades porque encostariam numa vizinha ou na Red Line.
- **Screenshots do dev server** às vezes vêm com módulos velhos do cache; conferir mudanças pelo
  build (`vite preview`). Animações: usar `?shipt=s`, que simula os 3 s anteriores.
- **Grand Line em baixa resolução:** prints com ilhas de 20–60 px e rótulos; Skypiea não entrou.
- **Encaixe das faixas da Grand Line** medido a olho; erro possível de alguns % na horizontal.
- **Margens vazias** perto da Red Line onde o mapa dos prints é mais estreito.
- **Risquinhos brancos** nas pontas dos canais da Reverse Mountain.
- **Malha de 5,9 MB** (era 5,5; as ilhas que cresceram ganharam platôs); não testada em tablet.
- Screenshots headless mostram faixa escura na borda (artefato do Edge headless).

## Próximos passos

1. Rota completa: mais locais em `geo/places.json` (a rota pelo mar já sai sozinha);
   travessia na Ilha dos Tritões e Reverse Mountain (a rota hoje não atravessa a Red Line).
2. Dados: ~1150 episódios do anime + One Pace (links, sinopse), tradução PT.
3. Locais: nomes/posições das ilhas (dos prints), episódio → local.
4. Barra `< Arco · Ep >`, lista, painel da ilha, progresso, exportar/importar.
5. Modelos do navio e troca conforme o episódio; zoom da câmera em viagens longas.
6. Zoom detalhado em 1 ilha do East Blue.
7. Dropdown de idioma.
8. Hospedagem e teste em tablet.

Em aberto com o usuário: prints da Grand Line mais aproximados (3–4 por faixa).

## Referências

- Repositório (privado): https://github.com/lgpassarini/one-map
- Mapa de referência: `reference/world-map-xads181.jpeg` (mapa de fã do xads181, r/OnePiece)
- Prints das regiões: `reference/regions/*.png` + `align.json`
- Stack: Vite + React + TypeScript + React Three Fiber + drei; scripts Node (sharp, d3-contour)
- Rodar: `npm install`, `npm run dev`; mapa: `npm run geo:extract` → `npm run geo:terrain` (já roda
  a rota; só a rota: `npm run geo:route`) (`npm run geo:align` antes, se trocar um print);
  dev: `?quality=low|high`, `?at=x,y&dist=n`, `?shipt=s` (adianta a animação do navio)
