export interface WorkflowParamMapping {
  nodeIds: Record<string, Record<string, any>>;
  outputPrefix: string;
  workflowFile?: string;
  customSizeNodeId?: string;
}

export const VIDEO_WORKFLOW_PARAM_MAPS: Record<string, WorkflowParamMapping> = {
  image_to_video: {
    nodeIds: {
      '45': { image: '{{inputImage}}' },
      '36': { prompt: '{{prompt}}' },
      '16': { aspect_ratio: '{{aspectRatio}}' },
    },
    outputPrefix: 'video',
    workflowFile: '(8步极速)10Eros Test4双时钟图生视频.json',
    customSizeNodeId: '6',
  },
  ltx23_t2v: {
    nodeIds: {
      '36': { prompt: '{{prompt}}' },
      '16': { aspect_ratio: '{{aspectRatio}}' },
    },
    outputPrefix: 'MiniMaxH3',
    workflowFile: '(8步极速)10Eros Test4双时钟文生视频.json',
    customSizeNodeId: '6',
  },
  ltx23_i2v: {
    nodeIds: {
      '20': { image: '{{inputImage}}' },
      '79': { audio: '{{inputAudio}}' },
      '33': { Number: '{{maxDimension}}' },
      '146': { text: '{{prompt}}' },
      '50': { text: '{{negativePrompt}}' },
    },
    outputPrefix: 'qq',
    workflowFile: 'LTX2.3极速版+图生视频+图片音频双驱动+自动生提示词+优化版.json',
  },
};
