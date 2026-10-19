import type { ModelSize, TemplateId } from '../types/index.js';
import { GenerationError } from './errors.js';

export interface TemplateLayer { cells: Set<string>; role: 'body' | 'accent'; label: string }
type Rect = [number, number, number, number];

function layer(label: string, role: TemplateLayer['role'], rectangles: Rect[]): TemplateLayer {
  const cells = new Set<string>();
  for (const [x, y, width, depth] of rectangles) {
    for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) cells.add(`${x + dx},${y + dy}`);
  }
  return { cells, role, label };
}

export const TEMPLATE_NAMES: Record<TemplateId, string> = { robot: '积木机器人', car: '积木小汽车', house: '积木小屋', animal: '积木小动物' };

/** Deliberately limited natural language routing: unknown requests never become robots. */
export function resolveTemplate(prompt: string): TemplateId {
  const text = prompt.trim().toLowerCase();
  if (!text) throw new GenerationError('请输入想拼搭的模型，例如「一个小机器人」。', 'INVALID_PROMPT');
  const matches: TemplateId[] = [];
  if (/机器人|機器人|robot|机甲|機甲/.test(text)) matches.push('robot');
  if (/汽车|汽車|小车|小車|赛车|賽車|\bcar\b|\bvehicle\b/.test(text)) matches.push('car');
  if (/房子|房屋|小屋|住宅|城堡|\bhouse\b|\bhome\b|\bcottage\b/.test(text)) matches.push('house');
  if (/动物|動物|小狗|小猫|小貓|小马|小馬|长颈鹿|長頸鹿|\banimal\b|\bdog\b|\bcat\b|\bhorse\b|\bgiraffe\b/.test(text)) matches.push('animal');
  if (!matches.length) throw new GenerationError('V0.1 支持机器人、汽车、小屋、动物四类规则模板。请在描述中明确选择其中一类；暂不支持任意造型生成。', 'UNSUPPORTED_PROMPT');
  if (matches.length > 1) throw new GenerationError('描述匹配了多个模型类别，请先选择机器人、汽车、小屋或动物中的一类。', 'AMBIGUOUS_PROMPT');
  return matches[0];
}

export function blueprint(template: TemplateId, size: ModelSize): TemplateLayer[] {
  const tier = { small: 0, balanced: 1, large: 2 }[size];
  if (template === 'robot') {
    const width = [6, 8, 10][tier], depth = tier === 2 ? 4 : 2;
    const foot = tier === 2 ? 4 : 2, torso = [4, 4, 6][tier], head = tier === 0 ? 2 : 4;
    return [
      layer('双脚', 'accent', [[0, 0, foot, depth], [width - foot, 0, foot, depth]]),
      layer('连接双腿的腰部', 'accent', [[0, 0, width, depth]]),
      layer('躯干', 'body', [[(width - torso) / 2, 0, torso, depth]]),
      ...(tier > 0 ? [layer('加高躯干', 'body', [[(width - torso) / 2, 0, torso, depth]])] : []),
      layer('肩膀和双臂', 'body', [[0, 0, width, depth]]),
      layer('头部', 'body', [[(width - head) / 2, Math.floor((depth - 2) / 2), head, 2]]),
      ...(tier > 0 ? [layer('加高头部', 'body', [[(width - head) / 2, Math.floor((depth - 2) / 2), head, 2]])] : []),
    ];
  }
  if (template === 'car') {
    const length = [6, 8, 10][tier], depth = tier === 2 ? 6 : 4;
    return [
      layer('四个积木轮廓轮与底部支撑', 'accent', [
        [0, 0, 2, 2], [length - 2, 0, 2, 2], [0, depth, 2, 2], [length - 2, depth, 2, 2],
        ...(tier === 2 ? [[2, 2, length - 4, 2] as Rect] : []),
      ]),
      layer('底盘', 'body', [[0, 1, length, depth]]),
      layer('车头与车身', 'body', [[0, 1, length, depth]]),
      layer('驾驶室', 'accent', [[2, 1, length - 4, depth]]),
    ];
  }
  if (template === 'house') {
    const width = [6, 8, 10][tier], depth = tier === 2 ? 8 : 6;
    const walls: Rect[] = [[0, 0, 2, depth], [width - 2, 0, 2, depth], [2, depth - 2, width - 4, 2]];
    return [
      layer('带门洞的墙体底层', 'body', walls),
      layer('加高墙体', 'body', walls),
      layer('跨接门洞的屋顶', 'accent', [[0, 0, width, depth]]),
      layer('交错连接的屋顶中脊', 'accent', [[1, 1, width - 2, depth - 2]]),
    ];
  }
  const length = tier === 0 ? 6 : 8, depth = tier === 2 ? 6 : 4;
  return [
    layer('四条腿', 'accent', [[0, 0, 2, 2], [length - 2, 0, 2, 2], [0, depth, 2, 2], [length - 2, depth, 2, 2]]),
    layer('连接四腿的身体', 'body', [[0, 1, length, depth]]),
    // One-stud offset deliberately crosses the lower body's vertical seam.
    layer('身体与尾巴', 'body', [[0, 1, length, depth], [-1, 1, 1, 2]]),
    layer('颈部', 'accent', [[length - 2, 1, 2, depth]]),
    ...(tier === 2 ? [layer('加高颈部', 'accent', [[length - 2, 1, 2, depth]])] : []),
    layer('头部', 'accent', [[length - 2, 1, 4, depth]]),
  ];
}
