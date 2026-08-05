# Image to 3D Lab

Estúdio com dois resultados separados a partir da mesma referência:

- **Pixel Character:** conjunto não editável de 1, 2, 4 ou 8 direções para uso direto no jogo;
- **Pixel 3D:** reconstrução voxel editável e exportável como GLB.

No Pixel 3D, o contrato do pipeline prevê oito vistas geradas internamente e ocultas na interface comum. A versão atual ainda usa a reconstrução semântica frontal local enquanto o adaptador multivista de IA não está conectado; a interface não duplica nem espelha a referência para fingir vistas ausentes.

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
- Pixel Character não oferece edição voxel;
- Pixel 3D mantém as oito imagens intermediárias fora do fluxo visual normal, mas deverá conservar diagnóstico técnico para QA.

O gerador de 2/4/8 direções está deliberadamente marcado como pendente até receber um modelo ou provedor real. Isso evita tratar espelhamento, repetição da referência ou rotação 2D como geração multivista.

## Executar

Requer Node.js 22.13 ou superior.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000/`.

## Validar

```bash
npm test
```

O teste executa o build de produção e verifica o HTML renderizado, o motor semântico, a edição voxel, a exportação e a integridade SHA-256 do exemplo MOB canônico.
