# Image to 3D Lab

Estúdio com dois resultados separados a partir da mesma referência:

- **Pixel Character:** conjunto 2D não editável de 1, 2, 4 ou 8 direções para uso direto no jogo;
- **Pixel 3D:** reconstrução voxel editável e exportável como GLB.

No Pixel 3D, o contrato do pipeline prevê oito vistas geradas internamente e ocultas na interface comum. No Pixel Character, o modo principal envia a referência frontal a um motor de IA multivista e recebe oito sprites 2D coerentes. A geometria voxel nunca é usada para fabricar sprites 2D.

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

O adaptador atual usa a API v2 do PixelLab somente no servidor. O template Canvas local continua disponível como modo experimental rápido, explicitamente separado do resultado de produção. Essa fronteira permite substituir o provedor por um modelo próprio no futuro sem alterar o editor ou o formato da spritesheet.

## Executar

Requer Node.js 22.13 ou superior.

```bash
npm install
Copy-Item .env.example .env.local
# preencha PIXELLAB_SECRET em .env.local
npm run dev
```

A chave nunca deve usar prefixo `NEXT_PUBLIC_`.

Abra `http://localhost:3000/`.

## Validar

```bash
npm test
```

O teste executa o build de produção e verifica o HTML renderizado, o motor semântico, a edição voxel, a exportação e a integridade SHA-256 do exemplo MOB canônico.
