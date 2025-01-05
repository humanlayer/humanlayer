import { HumanLayer as HumanLayerBase, HumanLayerParams } from 'humanlayer'

export const humanlayer = (params: HumanLayerParams) => {
  return new HumanLayer(params)
}

export class HumanLayer extends HumanLayerBase {

}