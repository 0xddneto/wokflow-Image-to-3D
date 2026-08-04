# Motor voxel local

## Por que ele pode ser leve

O produto não precisa resolver reconstrução 3D universal. A saída desejada é um
personagem voxel isométrico, e a entrada normalmente tem fundo transparente,
silhueta clara e pose frontal. Essas restrições substituem um modelo generativo
pesado por geometria computacional determinística.

O img2threejs também não é um modelo neural que descobre qualquer objeto em um
único passe. Ele organiza análise da imagem, landmarks, primitivas paramétricas,
câmera, renderização comparativa e correção iterativa. Para personagens voxel,
podemos codificar diretamente essa especialização no motor.

## Algoritmo alpha 0.4

1. Reamostrar a imagem na grade voxel com nearest-neighbor.
2. Obter a máscara pelo canal alpha ou pela distância da cor de fundo.
3. Medir caixa, eixo central, constrição do pescoço e faixas dos membros.
4. Calcular um campo de distância chamfer dentro da silhueta.
5. Usar a distância até a borda como raio de profundidade de cada coordenada
   frontal. O centro de cada forma fica profundo; as bordas convergem suavemente.
6. Preencher o interior entre frente e costas com voxels reais.
7. Manter a cor original na superfície frontal; sintetizar laterais e costas a
   partir da paleta representativa de cada parte.
8. Agrupar voxels em cabeça, tronco, braços, mãos, dedos, pernas e pés.
9. Renderizar com câmera ortográfica e ângulo isométrico.

Esse processo tem complexidade proporcional ao número de células da grade e
roda no navegador sem servidor, token ou GPU dedicada.

## Resultado verificado com a base MOB

- Entrada: 128 x 128 RGBA.
- Grade padrão: 128, preservando pixel a pixel a base nativa de 128×128.
- Frente: 4.787 pixels opacos preservados como 4.787 cubos frontais separados.
- Saída volumétrica: 52.961 voxels individuais em 12 partes.
- GLB exportado: 9.209.288 bytes.
- Frente, perfil e vista 3/4 verificadas no navegador.

## Editor de pixels

- Clique seleciona diretamente um pixel do modelo, sem expor grupos anatômicos na interface.
- `Shift + clique` adiciona ou remove pixels da seleção.
- `Ctrl + A`, Todos, Inverter, Limpar e `Esc` controlam a seleção.
- Cor, movimento X/Y/Z, restauração e exclusão são aplicados a um, vários ou todos os pixels selecionados.
- A barra inclui lápis, borracha, preenchimento, conta-gotas, seleção retangular, varinha, laço, linha, retângulo e círculo.
- O tamanho físico dos pixels pode ser alterado depois da geração, sem reconstruir o modelo nem descartar edições.
- Build e testes do site aprovados.

## Próximas melhorias locais

1. Substituir as faixas proporcionais por watershed/medial axis para separar
   membros em personagens com poses diferentes.
2. Adicionar guias anatômicas arrastáveis quando a detecção automática errar.
3. Salvar um projeto JSON/VOX com IDs estáveis de cada célula.
4. Implementar adicionar voxel, seleção múltipla, espelhamento e undo/redo.
5. Adicionar QA automático por comparação da silhueta renderizada com o input.
6. Reaproveitar uma base e um mapa de traits para gerar a coleção MOB em lote.
