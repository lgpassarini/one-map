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
- **Piso de tamanho:** ilhas pequenas crescem até ~4 unidades (o navio parado tinha ~2,2; hoje ~2,7), no máximo
  3×, e param antes de encostar numa vizinha ou na Red Line. Ganham relevo como se fossem desse
  tamanho. A escala de cada ilha fica em `islands.json` (`s`).
- **Reverse Mountain é um pico pontudo em platôs, não um cânion nem um cone liso:** usa o mesmo
  sistema de degraus e a mesma família de cor da Red Line, clareando até o pico, com contorno
  irregular. Quatro canais sobem dos quatro mares por gargantas entre paredões (a água sobe em
  degraus, animada) até o topo, e um desce para a Grand Line em 5 cachoeiras. Os canais são
  gerados de forma procedural (retos e simétricos), porque na referência o braço NE estava
  tapado pela rota pontilhada.
- **Rota:** gerada por script (`scripts/build-route.mjs`), não traçada à mão. Os locais ficam em
  `geo/places.json` (pixel no print da região, feito à mão); o porto é o ponto de mar mais perto
  com folga da costa, e entre portos um A* pela distância até a costa evita chegar a menos de ~0,7
  unidade e prefere mar aberto (~3). O app passa uma curva suave pelos pontos.
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
- **Visual igual ao do terreno:** o navio é montado com camadas extrudadas (topo claro, parede
  0,72× mais escura), toon shading de 3 tons e contorno fino na cor das linhas das ilhas. Um bote
  "liso" com contorno grosso destoava do mapa.
- **Animação:** acelera no primeiro ~30% da viagem, navega constante e freia no fim (3–7 s);
  virada, tamanho e "modo navegando" amortecidos; balança com ondas calculadas sob proa, popa e
  lados (o mar continua plano), inclina nas curvas; bandeirinha tremulando.
- **Rastro, não efeitos de vento/espuma:** testamos esteira em V, ondinhas e espuma na proa e
  descartamos. Fica só um rastro que segue o caminho do barco desde a popa, no estilo da costa
  (miolo em água rasa, bordas de espuma recortada), que alarga, afina na ponta e some em ~4 s.
- **Fora do mapa por enquanto (2026-11-25):** os navios ficam prontos no código, mas o mapa abre sem
  navio até existir a troca por episódio; `?navios` mostra o protótipo em dev. Na bandeira e nos
  símbolos (Jolly Roger, carneiro, leão, cúpulas) a fidelidade às referências importa; a estrutura
  do casco pode ser aproximada.
- **Merry e Sunny feitos à mão, não baixados:** modelos do Sketchfab serviram só de referência
  visual (o processo e a geometria são nossos); um modelo marcado como NoAI foi descartado até como
  referência. Mesmo método do bote (camadas extrudadas), mais peças arredondadas (carneiro, leão,
  mastros) com contorno "casco invertido" e velas/bandeiras com o Jolly Roger desenhado em canvas.
- **Porto:** a 2,6 unidades da costa, para o navio parado (e girando) não encostar na praia.
- **Chegada sem giro brusco (feedback do usuário, 2026-11-26):** o navio parado ficou maior
  (2,2 → 2,7 unidades). Navegando, a proa segue a rota de perto (um teto de velocidade de giro
  navegando foi testado e descartado: a proa atrasava e o barco andava de lado). Parado, vira
  devagar (até 0,6 rad/s, amortecido) para a próxima saída, uma vez, e só parte quando está
  apontado para ela (a pausa se estende se precisar). A entrada e a saída do porto são em linha
  reta nas últimas ~6 unidades, quando a reta não encosta na costa, para não haver curva fechada
  bem na chegada.
- **Sem voltinhas em torno da mesma ilha:** paradas seguidas com portos a menos de 5 unidades
  dividem o porto (Reverse Mountain → Whisky Peak, Ilha dos Tritões → Maubeugemour). Um ponto de
  mar a menos de 8 unidades do porto anterior fica no porto (os de Whisky Peak, Alabasta e Punk
  Hazard). Nesses casos a perna é `stay` (um ponto só) e o navio não se move.
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

## Dados de episódios e locais (sessão de perguntas em 2026-11-26)
- **Local por episódio, cruzando fontes:** os arcos do One Pace dão a divisão, e as páginas da
  One Piece Wiki dão as ilhas dentro de cada arco. Onde as fontes divergem, vai para revisão do
  usuário.
- **Local pelo arco, não pela cena** (revisto em 26/11): cada arco do anime fica num local só, a
  ilha ou região principal; os episódios de viagem até a ilha já contam como a ilha; flashbacks e
  cenas de outros personagens não mudam o local. `mar` só entre arcos sem ilha de destino
  (Post-Arabasta, Caesar Retrieval, Levely).
- **Fillers com ilha própria ficam nessa ilha** (Warship Island, Goat Island, Ruluka, G-8,
  Ocean's Dream, Lovely Land, Spa Island, Little East Blue, Maubeugemour, Silver Mine, Fron,
  Guilda Cidre), cadastradas com `kind: "filler"`. Isso substitui a decisão anterior de deixar
  os fillers no mar.
- **Exceções ao "local pelo arco":** Diary of Koby-Meppo (68–69) fica no mar entre Whisky Peak e
  Little Garden. Zou vai até o 779 (categoria da Wiki), Marine Rookie 780–782, Whole Cake 783–877.
- **`filler` de um arco = mais da metade dos episódios tem a tag `filler`** (a tag vem do
  opguide; misto não conta). Caesar Retrieval (626–628) fica `false`: só o 627 é filler puro; o
  626 adapta 2 páginas do cap. 699 e o 628 os caps. 699–700 (opguide e Wiki concordam). A
  aplicação ainda não usa o campo.
- **Especiais** ("Specials" na Wiki: 291, 292, 303, 336, 406, 407, 492, 542, 590, 907) ficam no
  arco e no local de antes. O 336 (Chopperman) segue essa convenção e fica em Ice Hunter.
- **`routeOrigin: "foosha"`** no `episodes.json`: o navio começa o mapa em Foosha, sem Foosha ser o
  local de nenhum episódio (o ep. 1 já é Shells Town).
- **Nomes das ilhas do mapa:** o Claude propõe a partir dos rótulos dos prints e do mapa do
  xads181 e gera uma imagem com os nomes; o usuário confere.
- **Locais especiais** (Skypiea, Ilha dos Tritões, Thriller Bark, Zou): pontos marcadores por
  enquanto; modelos próprios depois.
- **Campos no começo:** número, título (EN), arco, local, capítulos do mangá, episódio e link do
  One Pace, tags Filler/Recap. Sinopse e tradução entram junto com o dropdown de idioma.
- **A base é o anime oficial.** O One Pace é um fan cut e entra só como link. O arco de cada
  episódio é o da navegação da One Piece Wiki (com os arcos de filler e as minisséries de capa);
  os capítulos (opguide.app) e a divisão do One Pace servem para conferir.
- **Fontes:** opguide.app (capítulos, fillers), onepace.net (link do episódio que cobre cada
  episódio do anime), One Piece Wiki (título, arco, sinopse, recap).
- **O navio segue o arco** (ver "Local pelo arco" acima); as minisséries de capa ficam no local
  do arco em volta.
- **Escopo:** dados completos (1180) de uma vez; nomes das ilhas, rota, interface e navio por
  fatias de saga, começando pelo East Blue.

## Rota (passo 3, 2026-11-26)
- **Paradas pela ordem dos episódios:** uma parada por trecho de episódios seguidos no mesmo local
  (52 paradas, 51 pernas, de Foosha a Elbaf), gerada pelo `build-route` a partir do
  `episodes.json`. Um local que volta (Water 7, Long Ring, Impel Down, Amazon Lily, Sabaody, Wano)
  é outra parada no mesmo porto; a volta reaproveita o caminho da ida, invertido.
- **Mar = meio do caminho:** os 4 trechos no mar param na metade (em comprimento) do caminho entre
  o local de antes e o de depois.
- **Reverse Mountain:** o navio vai até a boca do canal do East Blue, sobe por ele até a piscina
  do topo e desce pelo canal das cachoeiras; a parada (Twin Cape, Laboon) fica no mar ao pé das
  cachoeiras. Os pontos do canal levam a altura da água (`[x, z, y]`).
- **Ilha dos Tritões:** a perna Sabaody → Ilha dos Tritões vai até a Red Line da borda leste na
  altura da ilha, mergulha (y até −3) e sai da borda oeste; `jump` marca onde o navio troca de borda.
- **Skypiea** fica, por enquanto, no mar sob o marcador da nuvem (subida ao céu fica para os
  locais especiais).
- **Conferência:** o build avisa se algum ponto no mar fica a menos de `MIN_CLEAR` da costa;
  `node scripts/route-overlay.mjs [x0,z0,x1,z1 nome]` desenha a rota sobre o mapa.

## Stack
- Vite + React + TypeScript + React Three Fiber (Three.js) + drei.
- Scripts Node para extrair contornos e montar os dados.

## Primeira versão
1. Mundo inteiro (contornos extraídos) e rota inteira.
2. Todos os episódios no navegador, com o local definido **por episódio** (cruzando One Pace e
   Wiki; ver "Dados de episódios e locais"). Antes era por arco, com episódio a episódio só nos
   primeiros ~100.
3. Ilhas, rota, interface e navio por fatias de saga, começando pelo East Blue.
4. Zoom detalhado em **1 ilha do começo** (Vila Foosha ou outra do East Blue).
5. Depois: refinar arco a arco, mais ilhas detalhadas, travessias especiais, login.
