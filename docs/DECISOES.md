# One Map: decisões de design

Site pessoal em 3D que mostra o mapa do mundo de One Piece. O navio do Luffy navega até a ilha
do episódio em que você está, e cada ilha lista os episódios do anime, os capítulos do mangá e
os links do [One Pace](https://onepace.net). Nenhum vídeo é hospedado aqui, só links.

Decisões tomadas numa sessão de perguntas em 2026-11-25.

## Público e uso
- **Uso só pessoal.** Pode usar referências e assets oficiais e de fãs.
- **Desktop:** versão completa (água com reflexos, sombras, relevo).
- **Tablet e celular:** a mesma cena com qualidade reduzida, detectada automaticamente
  (água simples, sem sombras, texturas menores), com controles de toque e o painel de episódios
  como gaveta que sobe de baixo. Sem versão 2D separada.
- **Hospedagem:** site estático no GitHub Pages. Por enquanto o projeto é só local.

## Unidade de navegação e progresso
- **A base é o episódio do anime** (cerca de 1150). Cada episódio aponta para o episódio do
  One Pace que o cobre (muitos para um). Sem One Pace correspondente, aparece a mensagem
  "ainda não tem no One Pace" e nenhum link.
- **Fillers e recaps entram** no navegador com as tags `Filler` e `Recap`, sem pular nenhum.
  Ilhas que só existem em filler ganham um marcador no ponto aproximado da rota.
- **Progresso = o episódio selecionado**, salvo no localStorage. Não existe "assistido".
- **Sincronização entre aparelhos é manual:** exportar e importar, mais o link `?ep=405`.
  Login fica para o futuro.

## Navegador (barra no topo)
- `< Arco X · Ep N >`: as setas avançam ou voltam um episódio.
- Clicar no nome abre uma lista para escolher qualquer episódio.
- Escolher um episódio dispara a animação do navio até o local, **seguindo a rota real**,
  inclusive de volta.
- **A barra fica travada durante a animação.**
- **O episódio é salvo no início da animação:** recarregar a página já mostra o navio no destino.
- **Duração:** a viagem tem um tempo padrão (cerca de 2–3s). Em viagens longas, o navio acelera
  para caber num teto fixo (cerca de 6–8s), e a câmera se afasta durante o trajeto e volta a
  aproximar no destino.

## Mapa
- **Referência:** o mapa de fã do xads181 (`reference/world-map-xads181.jpeg`). Ele é só
  **referência, não textura**.
- **Geografia igual à da referência:** os contornos das ilhas são extraídos automaticamente
  (terra e mar separados pela cor) e convertidos em polígonos vetoriais, que podem ser
  ajustados num modo editor (só em dev).
- **Renderização 100% nossa, em estilo cartoon** (decidido depois de ver a primeira versão,
  semi-realista, que não agradou): ilhas em platôs como camadas de papel, cores chapadas por
  bioma, contorno escuro na costa e nos degraus, toon shading com 3 tons, Red Line como muralha
  de topo plano, oceano com cores chapadas, faixa rasa definida e anel de espuma em volta das ilhas.
- **Geometria de verdade, não grade deformada:** cada platô é uma peça extrudada a partir do seu
  contorno vetorial, com linha de contorno. A primeira versão (grade deformada por imagem de
  altura) deixava as ilhas serrilhadas/"tremidas".
- **Mapa limitado, sem dar a volta** (a volta ficava estranha em 3D: bordas vazando e a Red Line
  aparecendo repetida), **com o layout da referência:** faixas da Red Line de Mary Geoise nas
  duas bordas e a Reverse Mountain no centro. (Testamos cortar o mapa para a rota ficar contínua,
  mas o layout original foi preferido.) A rota cruza a borda na Ilha dos Tritões: o navio mergulha
  sob a Red Line na borda direita e emerge na esquerda, o que é canon. Perto do norte e do sul, a
  Red Line desce em degraus até o mar. **Fora do mapa é névoa branca** (camadas translúcidas que
  adensam para fora, céu e neblina quase brancos), e não nuvens em bolas, que pareciam densas e
  "de desenho dos Simpsons". A câmera tem zoom e inclinação limitados.
- **Ilhas vêm dos prints detalhados do usuário** (`reference/regions/`: North/East/West/South Blue,
  Paradise, New World), que são a verdade das posições e formatos; o xads181 continua dando a Red
  Line, a Reverse Mountain e os Calm Belts. Os prints não têm as mesmas proporções do xads181, então:
  nos quatro Blues cada print é encaixado pela terra que coincide (escala única); nas faixas da
  Grand Line (prints de baixa resolução) pelo quadro — Twin Cape/Red Line até Sabaody/Lodestar em x,
  Calm Belt a Calm Belt em y —, com o formato das ilhas em escala uniforme. Os nomes nos prints
  servem depois para ligar locais aos episódios.
- **Escala com espaço para os mares e para o navio:** as posições são espaçadas 2× (`MAP_SCALE`),
  mas cada ilha cresce só 1,25× em volta do próprio centro (`ISLAND_SCALE`). O resultado é muito
  mais mar entre as ilhas, como nos outros mapas de referência. Por isso um local dentro de uma
  ilha usa a transformação da ilha (`src/data/islands.json`, `mapPxToWorld`).
- **Reverse Mountain é um pico pontudo em platôs, não um cânion nem um cone liso:** usa o mesmo
  sistema de degraus e a mesma família de cor da Red Line, clareando até o pico, com contorno
  irregular. Quatro canais sobem dos quatro mares por gargantas entre paredões (a água sobe em
  degraus, animada) até o topo, e um desce para a Grand Line em 5 cachoeiras. Os canais são
  gerados de forma procedural (retos e simétricos), porque na referência o braço NE estava
  tapado pela rota pontilhada.
- **Rota:** traçada a partir da referência (vermelho antes do timeskip, amarelo depois) e
  guardada como curva própria.
- **Unidade do mapa = local, não arco.** Um arco pode passar por vários locais, e um local
  (Water 7, Sabaody) pode ser revisitado.
- Em arcos em que o bando está sem o navio (Impel Down, Marineford), o navio fica parado e o
  local ganha um marcador especial.

## Dois níveis de zoom
- **Visão do mundo:** a câmera acompanha o navio.
- **Zoom na ilha:** ao chegar, a câmera aproxima e mostra a versão detalhada, traçada a partir
  do mapa canônico daquela ilha, com os locais dos episódios marcados. Ao ganhar zoom, a ilha
  também tem o contorno corrigido na visão do mundo.
- As ilhas detalhadas são adicionadas uma de cada vez. Ilhas sem detalhe mostram só o painel.

## Navios
- Muda conforme o episódio: bote a remo, depois o Going Merry (de Syrup Village até o fim de
  Enies Lobby), depois o Thousand Sunny.
- Travessias especiais (Reverse Mountain, Knock Up Stream, descida até a Ilha dos Tritões)
  ficam **para depois**. Na v1 são trechos normais da rota.

## Dados
- Captura única, sem atualização automática. Scripts em `scripts/` geram JSON em `src/data/`.
- Por episódio do anime: número, título, tag (canon/misto/filler/recap), arco, local,
  capítulos do mangá e episódio do One Pace (título, sinopse, duração, links).
- **Dados coletados e dados feitos à mão ficam separados:** episódios e links de um lado,
  locais, coordenadas e mapeamento episódio→local do outro, para que uma nova coleta não
  apague o trabalho manual.

## Idioma
- Dropdown **PT-BR / EN** para a interface e o conteúdo, com a escolha salva no localStorage.
- O conteúdo vem em inglês das fontes e é traduzido para PT pelo Claude. Os dados guardam
  `{ en, pt }`, e sem tradução aparece o inglês. Os títulos oficiais da Crunchyroll BR podem
  substituir as traduções depois.

## Stack
- Vite + React + TypeScript + React Three Fiber (Three.js) + drei.
- Scripts Node para extrair contornos e montar os dados.

## Primeira versão
1. Mundo inteiro (contornos extraídos) e rota inteira.
2. Todos os episódios no navegador, com o local definido **por arco**.
3. Mapeamento **episódio a episódio** nos primeiros ~100 (East Blue até a entrada da Grand Line).
4. Zoom detalhado em **1 ilha do começo** (Vila Foosha ou outra do East Blue).
5. Depois: refinar arco a arco, mais ilhas detalhadas, travessias especiais, login.
