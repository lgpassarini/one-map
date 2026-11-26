# One Map: visão do projeto

Atualizado em 26/11/2026. Versão viva no claude.ai: https://claude.ai/artifact/SmgzNLyAsuurPYK3GRSd7w
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
| Progresso | Episódio selecionado = onde você está; salvo no localStorage no início da animação; sync manual pelo link `?ep=405` |
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
- **Navio:** peça de tabuleiro parado (~2,7 unidades; gira devagar, uma vez, ao chegar); navegando encolhe para 45%, com tamanho
  mínimo na tela. Feito como o terreno (camadas, topo claro/parede escura, contorno, toon).
  Deixa um rastro na água no estilo da costa (água rasa + espuma recortada).

## Onde estamos

Versão 1 (tag `v1.0.0`) + navios prontos. Bote, Going Merry e Thousand Sunny estão modelados
(bandeira, Jolly Roger, carneiro, leão e cúpulas conferidos com as referências do usuário) e no
mapa o navio do episódio viaja até o episódio escolhido.

**Dados de episódios prontos (passo 1, aprovado pelo usuário em 26/11/2026):** `npm run eps:fetch` baixa opguide.app, onepace.net e a
One Piece Wiki para `.cache/episodes/`; `npm run eps:build` cruza tudo em `src/data/episodes.json`
(1180 episódios, 52 arcos do anime oficial, um local por arco, 998 com link do One Pace) e gera
`docs/revisao-episodios.md` com os trechos de local e as divergências entre as fontes. O local de
cada episódio vem de `geo/episode-places.json` (feito à mão, 51 trechos, 42 locais com 12 ilhas de
filler); o navio começa em Foosha (`routeOrigin`). O build valida a estrutura e falha se houver
referência inválida. Os dados ainda não são usados pela aplicação.

**Locais no mapa prontos (passo 2, 26/11/2026):** os 42 locais têm posição em `geo/places.json`
(pixel no print da região; os fora dos prints, em posição aproximada) e aparecem no mapa com nome
e um X (`PlaceLabels.tsx`). Na revisão, o terreno ganhou as ilhas que faltavam (Drum, Amazon
Lily, Impel Down, Long Ring, Loguetown) e as ilhas cortadas pelos rótulos dos prints foram
consertadas; todos os locais caem em terra, menos os que ficam no mar de propósito (Baratie,
fillers no mar, Skypiea, o meio do anel de Long Ring).

**Rota pronta (passo 3, 26/11/2026):** o `build-route` monta a rota pela ordem dos episódios: 52
paradas (uma por trecho de episódios no mesmo local; os trechos no mar param no meio do caminho,
ou no porto quando o meio fica colado na ilha) e 51 pernas pelo mar. Paradas coladas dividem o
porto, para o navio não dar voltinhas em torno da mesma ilha. A perna para a Reverse Mountain sobe pelo canal do East Blue e desce pelas
cachoeiras (pontos com altura); a de Sabaody para a Ilha dos Tritões mergulha por baixo da Red
Line na borda leste e sai na oeste (`jump`). Na revisão com o usuário, a chegada ficou
sem giro: o navio parado (agora 2,7 unidades) fica como chegou, vira no lugar uma vez, devagar,
para sair, e navegando a proa mira 1,5 unidade à frente no caminho (aprovado em 26/11/2026).

**Interface pronta (passo 4, aprovada pelo usuário em 26/11/2026):** barra `< Arco · Ep N >` no topo
(`src/ui/EpisodeBar.tsx`) com as tags, setas e ← →, e lista de episódios por arco
com busca. O episódio fica em `src/state/episode.ts` (localStorage, `?ep=N`; 0 = Partida em
Foosha). O bote voltou ao mapa: fica na parada do episódio e, ao escolher outro, navega pela rota
até lá (ida ou volta, direto pelas paradas do meio, 2,2–7 s), com a barra travada e a câmera
acompanhando. Exportar/importar arquivo saiu do plano. Na revisão, a barra virou uma placa de
madeira pendurada por cordas no topo da tela (só `Arco · Ep N` e as tags; balança de leve ao trocar
de episódio; 60% de opacidade sem uso), e a lista ganhou moldura de madeira e rolagem no tema.

**Navio navegando pronto (passo 5, aprovado pelo usuário em 26/11/2026):** o navio muda conforme o episódio (bote até
o 17, Merry do 18 ao 312, Sunny a partir do 313; `shipModels.tsx`). Parado, troca no lugar com um
"pop"; numa viagem, troca ao passar por Syrup Village ou Water 7. Nas viagens longas a câmera se
afasta no caminho e volta a aproximar no destino. O protótipo `?navios` (e `?shipt`) saiu; o
`Ship.tsx` agora só tem o navio do bando. Na revisão: o giro de saída ficou mais rápido (180° em
~1,9 s) e entrou um medalhão de madeira no canto inferior direito (`ShipStatus.tsx`) com âncora
(parado) ou bússola (viajando); durante a viagem a câmera fica travada no navio, e clicar na âncora
leva a câmera de volta ao navio (centraliza, zoom inicial, norte para cima), ficando inativa quando
ela já está lá.

| Área | Estado |
| --- | --- |
| Mapa 3D | Pronto |
| Câmera | Pronta |
| Minimapa | Pronto |
| Qualidade móvel | Detecção automática; não testado num tablet real |
| Pipeline de geografia | Pronto (`scripts/`). Em 26/11 entraram as ilhas de neve (Drum, Balloon Terminal, Baltigo), as do Calm Belt (Amazon Lily, Impel Down) e Loguetown (caía fora da área do East Blue); ilhas cortadas por rótulos foram consertadas (`FIX_LABELS` em `merge-regions.mjs`: Dressrosa, Alabasta, Wano, Water 7, Loguetown, Conomi...) |
| Rota do navio | Pronta: 52 paradas na ordem dos episódios, com as travessias da Reverse Mountain e da Ilha dos Tritões (`scripts/build-route.mjs` → `src/data/route.json`; conferência com `node scripts/route-overlay.mjs`) |
| Navio | Pronto: bote, Going Merry e Thousand Sunny feitos em código no estilo do terreno (`Ship.tsx`, `merryModel.ts`, `sunnyModel.ts`, peças e Jolly Roger em `shipParts.ts`); viaja até o episódio escolhido, troca de navio conforme o episódio (`shipModels.tsx`), acelera/freia, balança nas ondas, encolhe navegando, deixa rastro (`Trail.ts`); a câmera se afasta nas viagens longas e fica travada no navio durante a viagem |
| Ícone do navio | Pronto: âncora/bússola no canto inferior direito; a âncora leva a câmera ao navio (`ShipStatus.tsx`; tema de madeira comum em `ui/wood.css`) |
| Barra de episódios | Pronta: placa de madeira pendurada (`EpisodeBar.tsx`) + estado do episódio (`state/episode.ts`) |
| Dados de episódios | Pronto e aprovado: `src/data/episodes.json` (`scripts/fetch-episodes.mjs`, `scripts/build-episodes.mjs`, locais em `geo/episode-places.json`) |
| Nomes no mapa | Os 42 locais com nome no 3D, no estilo dos rótulos dos prints (Alegreya negrito via @fontsource, letra escura com contorno branco, X de mapa do tesouro, anticolisão; `PlaceLabels.tsx`; tecla N liga/desliga, salvo em `mapSettings.ts`); posições em `geo/places.json`, conferência com `node scripts/places-overlay.mjs` |
| Barra de episódios / lista | Não começado |
| Zoom detalhado de ilha | Não começado |
| Idiomas | Não começado |
| Hospedagem | Repo privado; GitHub Pages pendente (Pro ou repo público) |

## Problemas conhecidos

- **Ilhas minúsculas** (< 8 px no print) seguem pequenas: o crescimento tem teto de 3×; 88 ilhas
  ficam abaixo de 4 unidades porque encostariam numa vizinha ou na Red Line.
- **Screenshots do dev server** às vezes vêm com módulos velhos do cache; conferir mudanças pelo
  build (`vite preview`). Animações: o Edge headless pode ser dirigido pelo protocolo de depuração
  (clicar na placa, digitar na busca e fotografar no meio da viagem).
- **Grand Line em baixa resolução:** prints com ilhas de 20–60 px e rótulos; Skypiea não entrou.
- **Encaixe das faixas da Grand Line** medido a olho; erro possível de alguns % na horizontal.
- **Margens vazias** perto da Red Line onde o mapa dos prints é mais estreito.
- **Risquinhos brancos** nas pontas dos canais da Reverse Mountain.
- **Malha de 6,0 MB** (era 5,5; as ilhas que cresceram ganharam platôs, e entraram as de neve e as
  do Calm Belt); não testada em tablet.
- **Ilhotas pequenas dos prints** são descartadas na extração (limpeza de resíduo dos rótulos),
  exceto onde `merge-regions.mjs` lista uma área `keepSmall` (hoje: o anel de Long Ring). Ficam
  de fora, por exemplo, a Ilha Karakuri (branca e minúscula) e ilhotas em volta das ilhas grandes.
- **Rótulos que cortam ilhas** só são consertados nas ilhas listadas em `FIX_LABELS`; uma regra
  geral juntaria ilhas separadas por um rótulo no estreito (Ilha Rubeck, Reino de Lvneel).
- Screenshots headless mostram faixa escura na borda (artefato do Edge headless).
- **Navio nos canais e no mergulho** não foi conferido no 3D (o Edge headless não carregou a cena
  perto do topo da Reverse Mountain); conferir no navegador com `?ep=61` e escolhendo o 62. Skypiea é uma
  parada no mar sob a nuvem, sem subida ao céu.
- **Locais fora dos prints** ficam em posição aproximada: Reverse Mountain (pelo xads181), as 12
  ilhas de filler (em ilhas sem nome ou no mar entre as ilhas da viagem) e Skypiea (na nuvem do
  print, acima de Jaya).

## Próximos passos

Plano fechado em 26/11/2026 (detalhes em DECISOES.md, "Dados de episódios e locais"). Os passos
2–5 avançam por saga, começando pelo East Blue.

1. ~~**Lista de episódios e locais**~~ — feito (26/11/2026).
2. ~~**Mapa ilha → arco → episódios**~~ — feito (26/11/2026): os 42 locais posicionados, com
   nomes no mapa; feito de uma vez para todas as sagas.
3. ~~**Rota**~~ — feito (26/11/2026): 52 paradas pela ordem dos episódios, de Foosha a Elbaf,
   com as duas travessias.
4. ~~**Interface**~~ — feito (26/11/2026): placa `< Arco · Ep >`, lista de episódios, progresso
   salvo, navio viajando até o episódio escolhido. Exportar/importar foi descartado.
5. ~~**Navio navegando**~~ — feito (26/11/2026): troca bote → Merry → Sunny conforme o episódio,
   câmera se afasta em viagens longas e fica travada no navio, ícone de âncora/bússola.
6. **Zoom da ilha (próximo)** com animação e painel, começando por 1 ilha do East Blue.
7. Depois: sinopses e dropdown de idioma (tradução PT), modelos das ilhas de filler e dos locais
   especiais, nomes das outras ilhas dos prints (opção B: ~200 nomes, com anticolisão por zoom),
   hospedagem e teste em tablet.

Em aberto com o usuário: prints da Grand Line mais aproximados (3–4 por faixa).

## Referências

- Repositório (privado): https://github.com/lgpassarini/one-map
- Mapa de referência: `reference/world-map-xads181.jpeg` (mapa de fã do xads181, r/OnePiece)
- Prints das regiões: `reference/regions/*.png` + `align.json`
- Stack: Vite + React + TypeScript + React Three Fiber + drei; scripts Node (sharp, d3-contour)
- Rodar: `npm install`, `npm run dev`; mapa: `npm run geo:extract` → `npm run geo:terrain` (já roda
  a rota; só a rota: `npm run geo:route`) (`npm run geo:align` antes, se trocar um print);
  dev: `?quality=low|high`, `?at=x,y&dist=n`, `?ep=N` (escolhe e salva o episódio); rota: `node scripts/route-overlay.mjs` (imagem em `reference/_debug/`); episódios: `npm run eps:fetch` (baixa as fontes) → `npm run eps:build`
