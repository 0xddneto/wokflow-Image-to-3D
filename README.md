# Image to 3D Lab

Estúdio com dois resultados separados a partir da mesma referência:

- **Pixel Character:** conjunto 2D não editável de 1, 2, 4 ou 8 direções para uso direto no jogo;
- **Pixel 3D:** reconstrução voxel editável e exportável como GLB.

No Pixel 3D, o contrato do pipeline prevê oito vistas geradas internamente e ocultas na interface comum. No Pixel Character, o modo principal usa as oito vistas 2D canônicas criadas e aprovadas pelo autor do MOB. A geometria voxel e o antigo modelo 3D rejeitado nunca são usados para fabricar sprites 2D.

## Reconstrução Pixel 3D atual

- pose e máscara de pessoa executadas localmente no navegador;
- fallback paramétrico próprio para sprites estilizados;
- elipsoides para cabeça, tronco, barriga, mãos e pés;
- cápsulas entre ombros, cotovelos, punhos, quadris, joelhos e tornozelos;
- voxels individuais selecionáveis, recoloríveis, móveis e removíveis;
- linhas escuras da referência usadas como cor frontal, não como geometria;
- exportação GLB com as edições aplicadas.

O detector e os arquivos WASM estão em `public/models` e `public/mediapipe`, portanto a imagem não precisa sair da máquina nesta versão.

## Contrato multivista

- 1 direção: sul/frente;
- 2 direções: frente e costas;
- 4 direções: cardeais;
- 8 direções: cardeais e diagonais;
- Pixel Character não oferece edição voxel e exporta uma spritesheet PNG;
- Pixel 3D mantém as oito imagens intermediárias fora do fluxo visual normal, mas deverá conservar diagnóstico técnico para QA.

O motor principal é executado inteiramente no navegador: carrega o rig 2D canônico, compara sua paleta com a referência e reutiliza os pixels aprovados sem reamostragem quando a base coincide. Em variantes cromáticas, transfere índices de paleta sem mudar anatomia, contorno ou transparência. O template Canvas antigo continua disponível somente como comparação experimental.

As vistas estão em `public/models/mobs-canonical-directions`. O manifesto registra autoria, aprovação, direção, dimensões e SHA-256 de cada PNG. Essa primeira versão é especializada no corpo MOB; novos corpos e traits deverão entrar como folhas multivista próprias antes de alimentar o treinamento local.

## Executar

Requer Node.js 22.13 ou superior.

```bash
npm install
npm run dev
```

Não há token, API ou serviço externo necessário para gerar os sprites.

Abra `http://localhost:3000/`.

## Validar

```bash
npm test
```

O teste executa o build de produção e verifica o HTML renderizado, o motor semântico, a edição voxel, a exportação e a integridade SHA-256 do exemplo MOB canônico.
