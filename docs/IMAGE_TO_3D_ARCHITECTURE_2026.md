# Arquitetura Image-to-3D — decisão técnica 2026

Data da análise: 2026-08-04

## Resultado

O produto não deve tentar reconstruir um personagem repetindo os pixels da imagem
no eixo Z. Esse procedimento cria placas, faixas e partes desconectadas; ele não
infere volume, anatomia nem superfícies ocultas.

A solução deve ser um orquestrador de modelos 3D existentes, seguido de uma etapa
própria de reconstrução/edição. Não é economicamente razoável treinar um modelo
fundacional de imagem para 3D do zero para a primeira versão.

Há também um limite físico: uma única imagem não contém o lado de trás nem todas
as superfícies oclusas. O produto pode preservar a vista fornecida com alta
fidelidade e gerar lados/traseira coerentes, mas as partes invisíveis são uma
inferência. Quando o usuário fornecer frente, perfil e costas, o sistema deve
tratar essas vistas como restrições adicionais e produzir um resultado mais fiel.

## Tecnologias avaliadas

| Tecnologia | Papel possível | Decisão |
| --- | --- | --- |
| [Pixal3D](https://github.com/TencentARC/Pixal3D) | Imagem para geometria e materiais PBR com correspondência pixel-3D | Núcleo principal. Código/pesos em MIT e dependências declaradas MIT/Apache. |
| [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) | Backbone 3D de alta resolução com O-Voxels | Alternativa/fallback do núcleo principal. Exige GPU de servidor. |
| [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects) | Objetos em cenas, oclusões e múltiplos objetos | Rota opcional para fotografias complexas; licença própria e requisito de 32 GB VRAM. |
| [SAM 3D Body](https://github.com/facebookresearch/sam-3d-body) + [MHR](https://github.com/facebookresearch/MHR) | Prior anatômico e esqueleto humano | Útil para humanos realistas; não será a base dos MOBs chibi/pixel. |
| [AniGen](https://github.com/VAST-AI-Research/AniGen) | Imagem diretamente para mesh, skeleton e skin weights | Referência técnica. Não usar na rota comercial enquanto houver dependência não comercial. |
| [SkinTokens](https://github.com/VAST-AI-Research/SkinTokens) | Auto-rig completo de uma malha | Primeira escolha para rig em worker de GPU; MIT, requer ao menos 14 GB VRAM. |
| [RigAnything](https://github.com/Isabella98Liu/RigAnything) | Auto-rig template-free e GLB rigado | Fallback para rig e comparação de qualidade/licença. |
| [InstantMesh](https://github.com/TencentARC/InstantMesh) | Multiview sintético + reconstrução rápida | Rota de preview/fallback, não o resultado final de maior fidelidade. |
| [Unique3D](https://github.com/AiuniAI/Unique3D) | Cores e normais multiview + reconstrução | Referência para consistência de vistas e normais. |
| [Voxify3D](https://github.com/yichuanH/Voxify3D_official) | Malha sólida para voxel art em seis vistas | Referência do nosso algoritmo; código/checkpoints oficiais são somente não comerciais. |

## Pipeline definitivo

### Entrada comum

1. Validar PNG/JPEG e manter o arquivo original sem redimensionamento destrutivo.
2. Extrair ou validar o canal alpha e a máscara do personagem.
3. Detectar tipo de entrada: objeto, humanoide estilizado ou humano realista.
4. Normalizar enquadramento e câmera sem pintar um fundo na imagem.
5. Guardar seed, hash do arquivo, versão do modelo e parâmetros para reprodução.

### Saída 3D lisa

1. Executar Pixal3D em worker Linux/NVIDIA para gerar geometria e PBR.
2. Renderizar oito vistas de controle: frente, diagonais, perfis e costas.
3. Comparar a vista frontal com a imagem de entrada usando máscara, landmarks e
   erro perceptual; rejeitar automaticamente gerações abaixo do limite de QA.
4. Reparar malha, normais, componentes soltos e materiais.
5. Fazer auto-rig com SkinTokens; usar RigAnything como comparação/fallback.
6. Exportar GLB editável, preview e relatório de fidelidade.

### Saída pixel 3D editável

1. Começar pela malha sólida aprovada no pipeline 3D — nunca pela extrusão do PNG.
2. Voxelizar o interior da malha em uma grade esparsa e remover voxels internos
   que não precisam ser renderizados, mantendo conectividade e partes semânticas.
3. Renderizar seis vistas ortográficas e otimizar ocupação, profundidade, alpha e
   aparência contra as vistas da malha.
4. Quantizar as cores para uma paleta controlável. Para a primeira versão,
   K-means/median-cut; posteriormente, seleção diferenciável semelhante ao
   Gumbel-Softmax descrito pelo Voxify3D, implementada por nós.
5. Transferir os pesos do rig aos centros dos voxels e agrupar voxels por osso e
   parte semântica: cabeça, tronco, braço, mão, dedos, pernas e pés.
6. Expor cada voxel como instância independente no editor web, com selecionar,
   pintar, mover, adicionar, remover, espelhar e desfazer/refazer.
7. Exportar GLB com instancing/mesh otimizado e um formato de projeto próprio que
   preserve voxels, paleta, partes e histórico de edição.

## Arquitetura de execução

```text
Browser / site
  -> POST /jobs (imagem, modo, seed, vistas opcionais)
  -> armazenamento do arquivo original
  -> fila persistente
  -> worker GPU Linux
       -> preprocessamento
       -> Pixal3D/TRELLIS.2
       -> QA multiview
       -> rig opcional
       -> voxelização opcional
       -> GLB + projeto voxel + previews
  -> GET /jobs/:id
  -> editor Three.js
```

O site atual pode continuar em Cloudflare/Sites, mas CUDA não pode rodar nele. O
worker precisa ser um serviço de GPU separado e assíncrono. A API pública de um
Space gratuito do Hugging Face serve para protótipo, não para produção: tem fila,
quota e arquivos temporários.

## Limites de hardware verificados

A máquina local possui uma NVIDIA GeForce RTX 3050 Laptop com 4 GB de VRAM. Isso
é suficiente para o editor Three.js e ferramentas leves, mas não para os modelos
principais:

- TRELLIS.2: pelo menos 24 GB de VRAM segundo o repositório oficial.
- SAM 3D Objects: pelo menos 32 GB de VRAM.
- AniGen: pelo menos 18 GB de VRAM.
- SkinTokens: pelo menos 14 GB de VRAM.

Portanto, a geração deve rodar em GPU de nuvem e a edição/visualização permanece
local no navegador.

## Estratégia específica para 10 mil MOBs

Não gerar 10 mil esqueletos e anatomias independentes. Primeiro criar e aprovar
uma única base MOB 3D/voxel, com um rig canônico e um mapa determinístico entre
pixels, superfície, voxels e ossos. Depois transferir traits, paletas e pequenas
variações para a base compartilhada. Casos 1/1 podem passar pelo pipeline completo.

Isso oferece consistência visual, animações compatíveis, arquivos menores e um
custo de geração muito inferior ao de 10 mil reconstruções independentes.

## Teste prático da base MOB

Entrada canônica testada:

- Arquivo: `assets/pixel_oficial/base_mobs_pixel_128_v1.png`
- Dimensões: 128 x 128 RGBA
- Tamanho: 3.614 bytes
- SHA-256: `67CA2D2A95DF8F79DF891CFB7D4494716615AB8D2AE5C657152D3B077C36319E`
- Seed: 42
- Resolução Pixal3D: 1024

A API oficial do Pixal3D aceitou o PNG, preservou a transparência e concluiu a
geração neural em aproximadamente 67 segundos. O retorno continha oito vistas de
normal, máscara, cor-base, metallic, roughness, alpha, clay e três iluminações,
além do estado 3D. A extração do GLB foi bloqueada depois pela quota gratuita do
ZeroGPU (`240s requested vs. 0s left`). Isso valida a integração e o modelo, mas
não constitui um GLB final validado visualmente.

## Critérios de aceite antes de publicar

- A vista frontal deve preservar silhueta e proporções do input.
- Perfil e costas devem ser volumes coerentes, sem repetir a textura frontal.
- Cabeça, tronco, braços, mãos, dedos, pernas e pés devem ser partes identificáveis.
- Nenhuma geometria principal pode ficar desconectada sem intenção.
- Voxel deve ser uma célula 3D individual e editável.
- GLB precisa abrir novamente no editor e no Blender sem perder materiais/rig.
- O teste visual deve cobrir frente, perfil e 3/4.
- Nenhum build ou deploy será publicado apenas por passar testes de código.

## Próxima implementação

1. Remover o motor heurístico do caminho de geração principal.
2. Criar o contrato de jobs e um adapter de worker com Pixal3D.
3. Persistir input, resultado e metadados por job.
4. Construir o voxelizador de malha e o formato editável.
5. Integrar rig como job opcional.
6. Validar a base MOB e somente então publicar a nova versão.
