# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: assembly.spec.ts >> uses newly imported 3062b from the ordinary interface generator and reimports its exported model
- Location: tests/e2e/assembly.spec.ts:271:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - link "Bricklab 首页" [ref=e5] [cursor=pointer]:
      - /url: "#"
      - generic [ref=e10]: bricklab.
    - navigation "主导航" [ref=e11]:
      - button "真实零件库" [ref=e12] [cursor=pointer]
      - button "接口与拼接库" [ref=e13] [cursor=pointer]
      - button "通用创意" [ref=e14] [cursor=pointer]
      - button "Speed Creative" [ref=e15] [cursor=pointer]
      - button "自由汽车设计" [ref=e16] [cursor=pointer]
      - button "我的拼搭指南" [disabled] [ref=e17]
    - button "PART LAB · 来源核验中" [ref=e18] [cursor=pointer]:
      - text: PART LAB
      - generic [ref=e20]: · 来源核验中
  - main [ref=e24]:
    - generic [ref=e25]:
      - generic [ref=e26]:
        - generic [ref=e27]: PART LAB · REAL PARTS FOUNDATION
        - heading "从真实零件，开始拼搭。" [level=1] [ref=e29]
        - paragraph [ref=e30]: 逐项查看说明书证据、原生几何和连接来源，让每个进入生成器的零件都有依据。
      - generic [ref=e36]:
        - text: 真实资料库
        - generic [ref=e37]: 来源可追溯 · 分阶段验证
    - generic "零件可信状态统计" [ref=e38]:
      - generic [ref=e39]:
        - strong [ref=e40]: "531"
        - text: 仅目录
      - generic [ref=e41]:
        - strong [ref=e42]: "254"
        - text: 已有真实几何
      - generic [ref=e43]:
        - strong [ref=e44]: "206"
        - text: 已有来源连接
      - generic [ref=e45]:
        - strong [ref=e46]: "111"
        - text: 已有碰撞数据
      - generic [ref=e47]:
        - strong [ref=e48]: "0"
        - text: 有已保存装配证明
      - generic [ref=e49]:
        - strong [ref=e50]: "105"
        - text: 语法可选零件
      - generic [ref=e51]:
        - strong [ref=e52]: "0"
        - text: 限定范围复核
    - paragraph [ref=e53]: 状态统计可重叠。LDraw 编号与 Element ID 分开登记，数量相加不代表真实设计零件总数。
    - paragraph [ref=e58]: Element、Design 与 LDraw 编号分别核对。已有来源的接口经语法识别进入候选，实际组合仍需单独通过装配检查；旧版参数化生成仍暂停。
    - tablist "零件工作台视图" [ref=e59]:
      - tab "零件检查" [ref=e60] [cursor=pointer]
      - tab "装配模式" [selected] [ref=e64] [cursor=pointer]
      - tab "说明书与套装" [ref=e69] [cursor=pointer]
      - button "刷新资料" [ref=e72] [cursor=pointer]
    - region "真实零件装配模式" [ref=e73]:
      - generic [ref=e74]:
        - generic [ref=e75]:
          - heading "真实装配验证" [level=2] [ref=e76]
          - paragraph [ref=e80]: 按有来源的接口语法求连接姿态，再检查实际组合的接口占用、闭合与碰撞。
        - button "刷新来源与语法" [ref=e81] [cursor=pointer]
      - generic "接口语法与装配统计" [ref=e82]:
        - generic [ref=e83]:
          - strong [ref=e84]: "254"
          - text: 原生来源零件
        - generic [ref=e85]:
          - strong [ref=e86]: "105"
          - text: 语法可选零件
        - generic [ref=e87]:
          - strong [ref=e88]: "0"
          - text: 有已保存装配证明
        - generic [ref=e89]:
          - strong [ref=e90]: "149"
          - text: 当前不可选零件
      - paragraph [ref=e91]: 语法可选表示已有接口符合受支持规则。每个实际生成或导入的模型仍单独检查；未知配合与实体实拼不会自动计为通过。
      - region "物理接口验证覆盖" [ref=e92]:
        - heading "物理接口验证覆盖" [level=3] [ref=e93]
        - paragraph [ref=e94]: 这里统计逐接口装配测试记录，历史试拼 PASS 不会自动继承。语法可选数量单独统计，实际装配结果在下方显示。
        - generic [ref=e95]:
          - generic [ref=e96]:
            - generic [ref=e97]: 已发现物理接口
            - strong [ref=e98]: "5024"
          - generic [ref=e99]:
            - generic [ref=e100]: PASS
            - strong [ref=e101]: "0"
          - generic [ref=e102]:
            - generic [ref=e103]: BLOCKED
            - strong [ref=e104]: "0"
          - generic [ref=e105]:
            - generic [ref=e106]: REQUIRES_ASTRA_REVIEW
            - strong [ref=e107]: "0"
          - generic [ref=e108]:
            - generic [ref=e109]: PENDING
            - strong [ref=e110]: "5024"
        - generic [ref=e111]:
          - generic [ref=e112]:
            - term [ref=e113]: 已验证覆盖率
            - definition [ref=e114]: 0%
          - generic [ref=e115]:
            - term [ref=e116]: 已处理覆盖率
            - definition [ref=e117]: 0%
        - generic [ref=e118]:
          - generic [ref=e119]:
            - term [ref=e120]: 原始来源连接记录
            - definition [ref=e121]: "5089"
          - generic [ref=e122]:
            - term [ref=e123]: 逻辑连接组
            - definition [ref=e124]: "3068"
          - generic [ref=e125]:
            - term [ref=e126]: 已验证物理接口
            - definition [ref=e127]: "0"
          - generic [ref=e128]:
            - term [ref=e129]: 已开放原始连接 ID
            - definition [ref=e130]: "0"
          - generic [ref=e131]:
            - term [ref=e132]: 已开放物理接口
            - definition [ref=e133]: "0"
        - paragraph [ref=e134]: 已验证覆盖率 = PASS / 已发现物理接口；已处理覆盖率还包含 BLOCKED 与 Astra 待审。原始记录、逻辑组与物理接口是不同单位，不能相加。验证通过与运行时开放分别记录。
      - generic [ref=e135]:
        - generic [ref=e136]:
          - term [ref=e137]: 语法开放原始接口
          - definition [ref=e138]: "2546"
        - generic [ref=e139]:
          - term [ref=e140]: 符合规则的接口特征
          - definition [ref=e141]: "4253"
        - generic [ref=e142]:
          - term [ref=e143]: 有已保存装配证明的零件
          - definition [ref=e144]: "0"
      - generic [ref=e145]:
        - generic [ref=e146]:
          - generic [ref=e147]:
            - generic [ref=e148]: Part A · 固定零件
            - combobox "选择固定零件 A" [ref=e149]:
              - option "2431 · Tile 1 x 4 with Groove"
              - option "2445 · Plate 2 x 12"
              - option "2456 · Brick 2 x 6"
              - option "3001 · Brick 2 x 4"
              - option "3002 · Brick 2 x 3"
              - option "3003 · Brick 2 x 2"
              - option "3004 · Brick 1 x 2"
              - option "3005 · Brick 1 x 1"
              - option "3006 · Brick 2 x 10"
              - option "3007 · Brick 2 x 8"
              - option "3008 · Brick 1 x 8"
              - option "3009 · Brick 1 x 6"
              - option "3010 · Brick 1 x 4"
              - option "3020 · Plate 2 x 4"
              - option "3021 · Plate 2 x 3"
              - option "3022 · Plate 2 x 2"
              - option "3023 · ~Moved To 3023b"
              - option "3024 · Plate 1 x 1" [selected]
              - option "3026 · Plate 6 x 24"
              - option "3027 · Plate 6 x 16"
              - option "3028 · Plate 6 x 12"
              - option "3029 · Plate 4 x 12"
              - option "3030 · Plate 4 x 10"
              - option "3031 · Plate 4 x 4"
              - option "3032 · Plate 4 x 6"
              - option "3033 · Plate 6 x 10"
              - option "3034 · Plate 2 x 8"
              - option "3035 · Plate 4 x 8"
              - option "3036 · Plate 6 x 8"
              - option "3038 · Slope Brick 45 2 x 3"
              - option "3039 · Slope Brick 45 2 x 2"
              - option "3041 · Slope Brick 45 2 x 4 Double"
              - option "3460 · Plate 1 x 8"
              - option "3622 · Brick 1 x 3"
              - option "3641 · Tyre 6/ 50 x 8 Offset Tread"
              - option "3666 · Plate 1 x 6"
              - option "3673 · Technic Pin"
              - option "3700 · Technic Brick 1 x 2 with Hole"
              - option "3710 · Plate 1 x 4"
              - option "3795 · Plate 2 x 6"
              - option "3832 · Plate 2 x 10"
              - option "3958 · Plate 6 x 6"
              - option "4070 · Brick 1 x 1 with Headlight"
              - option "4079 · Minifig Seat 2 x 2"
              - option "4162 · Tile 1 x 8"
              - option "4282 · Plate 2 x 16"
              - option "4477 · Plate 1 x 10"
              - option "4600 · Plate 2 x 2 with 2 Wheel Pins"
              - option "4624 · Wheel Rim 6.4 x 8"
              - option "6111 · Brick 1 x 10"
              - option "6636 · Tile 1 x 6"
              - option "11211 · Brick 1 x 2 with Two Studs on One Side"
              - option "11212 · Plate 3 x 3"
              - option "11477 · Slope Brick Curved 2 x 1"
              - option "14769 · Tile 2 x 2 Round with Round Underside Stud"
              - option "15068 · Slope Brick Curved 2 x 2 x 0.667"
              - option "15573 · Plate 1 x 2 with Groove with 1 Centre Stud, without Understud"
              - option "18973 · Windscreen 6 x 4 x 1.333 Curved"
              - option "18974 · Car Mudguard 4 x 2.5 x 2.333"
              - option "18975 · Plate 2 x 4 with Side Bricks 1 x 2 x 1.333 with Hole"
              - option "18976 · Wheel Rim 11 x 18 with Vented Disc Brake"
              - option "18977 · Tyre 11.2/ 28 x 17.6 Intermediate"
              - option "24299 · Wing 2 x 2 Left"
              - option "24307 · Wing 2 x 2 Right"
              - option "26603 · Tile 2 x 3"
              - option "29119 · Slope Brick Curved 2 x 1 with Cutout Right"
              - option "29120 · Slope Brick Curved 2 x 1 with Cutout Left"
              - option "35789 · Car Mudguard 4 x 2.5 x 2 with Rounded Ends"
              - option "41769 · Wing 2 x 4 Right"
              - option "41770 · Wing 2 x 4 Left"
              - option "43722 · Wing 2 x 3 Right"
              - option "43723 · Wing 2 x 3 Left"
              - option "47905 · Brick 1 x 1 with Studs on Two Opposite Sides"
              - option "50950 · Slope Brick Curved 3 x 1"
              - option "52107 · Brick 1 x 2 with Studs on Sides"
              - option "54200 · Slope Brick 31 1 x 1 x 0.667"
              - option "62360 · Windscreen 3 x 6 x 1 Curved"
              - option "63864 · Tile 1 x 3"
              - option "65632 · Windscreen 6 x 6 x 1.667 Curved"
              - option "65633 · Windscreen 6 x 6 x 1.333 Angled Curved"
              - option "65635 · Plate 2 x 6 with Side Bricks 1 x 2 x 1.333 with Axlehole"
              - option "66727 · Wheel Rim 11 x 18 with Drilled Disc Brake"
              - option "85984 · Slope Brick 31 1 x 2 x 0.667"
              - option "87079 · Tile 2 x 4 with Groove"
              - option "87087 · Brick 1 x 1 with Stud on 1 Side"
              - option "87552 · Panel 1 x 2 x 2 Reinforced"
              - option "87580 · Plate 2 x 2 with Groove with 1 Centre Stud"
              - option "91988 · Plate 2 x 14"
              - option "98138 · Tile 1 x 1 Round with Groove"
              - option "98282 · Car Mudguard 4 x 2.5 x 1"
              - option "99206 · Plate 2 x 2 x 0.667 with Two Studs On Side and Two Raised with Closed Understud"
              - option "99207 · Bracket 1 x 2 - 2 x 2 Up"
              - option "99780 · Bracket 1 x 2 - 1 x 2 Up"
              - option "99781 · Bracket 1 x 2 - 1 x 2 Down"
              - option "3023b · Plate 1 x 2"
              - option "3068b · Tile 2 x 2 with Groove"
              - option "3069b · Tile 1 x 2 with Groove"
              - option "3070b · Tile 1 x 1 with Groove"
              - option "3794b · Plate 1 x 2 with Groove with 1 Centre Stud"
              - option "3040b · Slope Brick 45 2 x 1"
              - option "2412b · Tile 1 x 2 Grille with Groove"
              - option "10312 · Windscreen 6 x 10 x 3 with 1 x 2 x 1 Cutout - Ovoid"
              - option "103918 · Windscreen 4 x 4 x 2 with Integral Glass"
              - option "11289 · Windscreen 4 x 4 x 4.667 Canopy with Handle"
              - option "13252 · Windscreen 6 x 13 x 2"
              - option "13760 · Windscreen 2 x 6 x 2 Frame"
              - option "16477 · Windscreen 16 x 8 x 6 Curved with 3 Pin Holes"
              - option "17454 · Windscreen 2 x 6 x 2 Vertical Frame"
              - option "17457 · Windscreen 2 x 6 x 2 Vertical Glass"
              - option "18591 · Windscreen 4 x 4 x 5 Cone with Pins"
              - option "18729 · Windscreen 6 x 10 x 4 Curved"
              - option "1874 · Windscreen 9 x 6 x 1.667"
              - option "18972 · Windscreen 5 x 4 x 1.667 Curved"
              - option "18990 · Windscreen 4 x 4 x 1.667 Canopy Half Sphere with Handle Bar"
              - option "19212 · Windscreen 1 x 12 x 4 Trapezoidal"
              - option "20455 · Windscreen 9 x 4 x 7 Hemisphere with 4 Hollow Studs on Top"
              - option "20684 · Windscreen 3 x 8 x 3"
              - option "21 · Windscreen 2 x 4 x 1 & 2/3"
              - option "21849 · Windscreen 8 x 4 x 2 with Handle and 2 Studs"
              - option "22483 · Windscreen 6 x 4 x 1.333 Pointed"
              - option "2337 · Windscreen 4 x 4 x 2 Canopy Extender"
              - option "23448 · Windscreen 8 x 4 x 2 Curved with Handle"
              - option "2352 · Windscreen 2 x 4 x 3"
              - option "2418a · Windscreen 6 x 6 Octagonal Canopy without Axlehole"
              - option "1846 · Car Mudguard 4 x 3 x 1.667"
              - option "24151 · Car Mudguard 4 x 4"
              - option "2513 · Car Mudguard 3 x 4"
              - option "28326 · Car Mudguard 4 x 3 x 1"
              - option "3787 · Car Mudguard 2 x 4 without Studs"
              - option "3788 · Car Mudguard 2 x 4"
              - option "41854 · Car Mudguard 2 x 4 Swept Back"
              - option "44674 · Car Mudguard 3 x 4 Overhanging"
              - option "49097 · Car Mudguard 3 x 2.5 x 1"
              - option "50745 · Car Mudguard 4 x 2.5 x 2"
              - option "50947 · Car Mudguard 4.5 x 1 x 1"
              - option "60212 · Car Mudguard 2 x 4 with Central Hole"
              - option "62361 · Car Mudguard 6 x 1.5 x 1 with Arch"
              - option "80567 · Vehicle Mudguard 4 x 10 x 0.667"
              - option "93587 · Car Mudguard 3 x 4 x 1.667 Curved"
              - option "93590 · Car Mudguard 2 x 4 with Headlights and Curved Fenders"
              - option "93597 · Car Mudguard 3 x 4 x 1.333 Curved with Headlights"
              - option "98835 · Car Mudguard 3 x 4 x 1.667 with Curved Front"
              - option "11215 · Bracket 5 x 2 x 1.333"
              - option "14520 · Bracket 2 x 4 x 0.667 with Front Studs and Deep Arches"
              - option "18671 · Bracket 3 x 2 x 1.333"
              - option "18986 · Bracket 1 x 1 - 1 x 2"
              - option "2422 · Bracket 2 x 2 - 1 x 4"
              - option "2436a · Bracket 1 x 2 - 1 x 4 with Square Corners"
              - option "2436b · Bracket 1 x 2 - 1 x 4 with Rounded Corners"
              - option "28802 · Bracket 1 x 2 - 1 x 4 with Rounded Bottom Corners"
              - option "28964 · Bracket 5 x 2 x 2.333 with Inside Fillets with Reinforced Bottom"
              - option "28974a · Bracket 1 x 1 - 1 x 1 Thick with Stud Hole"
              - option "30209 · Bracket 1 x 2 - Dish 4 x 4"
              - option "30250 · Bracket 4 x 7 x 3"
              - option "30263 · Bracket 6 x 12 x 1.333"
              - option "36840 · Bracket 1 x 1 - 1 x 1 Up"
              - option "36841 · Bracket 1 x 1 - 1 x 1 Down"
              - option "3956 · Bracket 2 x 2 - 2 x 2 Up"
              - option "41682 · Bracket 2 x 2 - 1 x 2 Up Centred"
              - option "42446 · Bracket 1 x 1 - 1 x 1 Thin with Stud Hole"
              - option "44728 · Bracket 1 x 2 - 2 x 2 Down"
              - option "4585 · Bracket 2 x 1 - 2 x 1 Up Centred"
              - option "4598 · Bracket 2 x 3 - 2 x 2"
              - option "4732 · Bracket 8 x 2 x 1 & 1/3"
              - option "48724 · Bracket 1 x 1 - 1 x 1 with Pin"
              - option "5090 · Bracket 1 x 6 with 1 x 4 Cutout - 2x 6 Up"
              - option "5175 · Bracket 2 x 4 - 1 x 4 Down"
              - option "52038 · Bracket 2 x 4 x 0.667 with Front Studs and Shallow Arches"
              - option "5712 · Bracket 5 x 1 x 1.333"
              - option "6087 · Bracket 5 x 2 x 2.333 with Inside Rib"
              - option "64570 · Bracket 2 x 6 - 1 x 6 Up with Rounded Corners"
              - option "65132 · Bracket 4 x 5 x 5 with 4 Locking Hinges with 2 Fingers, Four Studs and 12 Studs on Back"
              - option "69906 · Bracket 3 x 2 - 2 x 2 Down with Rounded Brace"
              - option "73562 · Bracket 3 x 2 x 1.333 with Bottom Stud Holder"
              - option "73825 · Bracket 1 x 1 - 2 x 1 Up"
              - option "76766 · Bracket 5 x 2 x 2.333 with Inside Fillets"
              - option "79389 · Bracket 1 x 1 - 2 x 1 Down"
              - option "93274 · Bracket 1 x 2 - 2 x 4"
              - option "98287 · Bracket 3 x 4 - 3 x 4 Up"
              - option "11290 · Slope Brick Curved 2 x 8 x 2 Double"
              - option "11301 · Slope Brick Curved 2 x 8 x 2 Inverted Double"
              - option "13547 · Slope Brick Curved 4 x 1 Inverted"
              - option "15625 · Slope Brick Curved 5 x 8 x 0.667"
              - option "24201 · Slope Brick Curved 2 x 1 Inverted"
              - option "24309 · Slope Brick Curved 3 x 2"
              - option "30602 · Slope Brick Curved Top 2 x 2 x 1"
              - option "32803 · Slope Brick Curved 2 x 2 Inverted"
              - option "41766 · Slope Brick Curved 8 x 2 x 2"
              - option "42022 · Slope Brick Curved 6 x 1"
              - option "42023 · Slope Brick Curved 6 x 1 Inverted"
              - option "42918 · Slope Brick Curved 8 x 2"
              - option "44126 · Slope Brick Curved 6 x 2"
              - option "44675 · Slope Brick Curved Top 2 x 2 x 1 with Dimples"
              - option "45410 · Slope Brick Curved 6 x 8 x 2 Inverted Double"
              - option "45411 · Slope Brick Curved 6 x 8 x 2 Double"
              - option "47456 · Slope Brick Curved 2 x 3 x 0.667 with Fin and 2 Studs"
              - option "47457 · Slope Brick Curved 2 x 2 x 2/3 Triple with Two Top Studs"
              - option "47458 · Slope Brick Curved 1 x 2 x 2/3 with Fin without Studs"
              - option "50967 · Slope Brick Curved 8 x 1 x 1 & 2/3 with Arch"
              - option "54091 · Slope Brick Curved 8 x 8 x 2 Inverted Double"
              - option "54095 · Slope Brick Curved 8 x 8 x 2 Double"
              - option "54096 · Slope Brick Curved 8 x 8 x 2 Double with Cutout"
              - option "56204 · Slope Brick Curved 6 x 8 x 2 Double"
              - option "61068 · Slope Brick Curved 2 x 4 without Underside Studs"
              - option "61487 · Slope Brick Curved 4 x 4 x 2"
              - option "61678 · Slope Brick Curved 4 x 1"
              - option "66955 · Slope Brick Curved 4 x 3.5 x 1 with 3 Steps"
              - option "66956 · Slope Brick Curved 2 x 2 with Double Cutout"
              - option "70681 · Slope Brick Curved 1 x 3 with 1 x 2 Inverted Cutout"
              - option "71771 · Slope Brick Curved 5 x 8 x 0.667 without Studs"
              - option "80177 · Slope Brick Curved 3 x 2 with Cutout Left"
              - option "80178 · Slope Brick Curved 3 x 2 with Cutout Right"
              - option "85970 · Slope Brick Curved 1 x 8 with Plate 1 x 2"
              - option "88930 · Slope Brick Curved 2 x 4 with Underside Studs"
              - option "93273 · Slope Brick Curved 4 x 1 Double"
              - option "93589 · Slope Brick Curved Tapered 4 x 2 on Plate 1 x 4"
              - option "93604 · Slope Brick Curved 3 x 4 x 0.667 Rounded"
              - option "93606 · Slope Brick Curved 4 x 2"
              - option "11291 · Wedge 3 x 4 x 0.667 Cutout"
              - option "13349 · Wedge 4 x 4 Triple Inverted with Ribs between Studs"
              - option "22390 · Wedge 6 x 8 Double with Cutout"
              - option "22391 · Wedge 4 x 4 Pointed"
              - option "2336 · Wedge 2 x 3 with Brick 2 x 4 Side Studs and Plate 2 x 2"
              - option "2399 · Wedge 3 x 4"
              - option "29115 · Wedge 6 x 6 Triple Inverted"
              - option "2916 · Wedge 4 x 6 x 2.333"
              - option "30382 · Wedge 2 x 12 Triple"
              - option "32084 · Wedge 6 x 8 Triple with Cutout 4 x 4"
              - option "41747 · Wedge 2 x 6 Double Right"
              - option "41748 · Wedge 2 x 6 Double Left"
              - option "41761 · Wedge 6 x 8 x 2 Triple Inverted"
              - option "41764 · Wedge 2 x 6 Double Inverted Right"
              - option "41765 · Wedge 2 x 6 Double Inverted Left"
              - option "41767 · Wedge 4 x 2 Right"
              - option "41768 · Wedge 4 x 2 Left"
              - option "42021 · Wedge 6 x 8 x 2 Triple Inverted"
              - option "42060 · Wedge 12 x 3 x 1 Double Rounded Right"
              - option "42061 · Wedge 12 x 3 x 1 Double Rounded Left"
              - option "42862 · Wedge 3 x 3 Sloped Left"
              - option "43710 · Wedge 4 x 2 Double Left"
              - option "43711 · Wedge 4 x 2 Double Right"
              - option "43712 · Wedge 6 x 4 Triple Curved"
              - option "48729b · Bar 1.5L with Clip with Truncated Sides and Hole in Shaft"
              - option "60470b · Plate 1 x 2 with 2 Clips Horizontal (Thick C-Clips)"
              - option "30374 · Bar 4L Lightsaber Blade"
              - option "32000 · Technic Brick 1 x 2 with Holes"
              - option "3623 · Plate 1 x 3"
              - option "60479 · Plate 1 x 12"
              - option "78329 · Plate 1 x 5"
              - option "3456 · Plate 6 x 14"
              - option "69729 · Tile 2 x 6"
              - option "6934 · Tile 3 x 6"
              - option "41539 · Plate 8 x 8"
              - option "3062b · Brick 1 x 1 Round with Hollow Stud"
          - generic [ref=e150]:
            - generic [ref=e151]: Connection A
            - combobox "Connection A" [ref=e152]:
              - option "已开放 · p/stud.dat:8:0 · stud · M · (0, 0, 0)" [selected]
              - option "已开放 · parts/s/3024s01.dat:8:1 · cylinder · F · (0, 8, 0)"
              - option "已开放 · parts/3024.dat:8:2 · cylinder · F · (0, 8, 0)"
        - generic [ref=e156]:
          - generic [ref=e157]:
            - generic [ref=e158]: Part B · 待装配零件
            - combobox "选择待装配零件 B" [ref=e159]:
              - option "2431 · Tile 1 x 4 with Groove"
              - option "2445 · Plate 2 x 12"
              - option "2456 · Brick 2 x 6"
              - option "3001 · Brick 2 x 4"
              - option "3002 · Brick 2 x 3"
              - option "3003 · Brick 2 x 2"
              - option "3004 · Brick 1 x 2"
              - option "3005 · Brick 1 x 1"
              - option "3006 · Brick 2 x 10"
              - option "3007 · Brick 2 x 8"
              - option "3008 · Brick 1 x 8"
              - option "3009 · Brick 1 x 6"
              - option "3010 · Brick 1 x 4"
              - option "3020 · Plate 2 x 4"
              - option "3021 · Plate 2 x 3"
              - option "3022 · Plate 2 x 2"
              - option "3023 · ~Moved To 3023b"
              - option "3024 · Plate 1 x 1"
              - option "3026 · Plate 6 x 24"
              - option "3027 · Plate 6 x 16"
              - option "3028 · Plate 6 x 12"
              - option "3029 · Plate 4 x 12"
              - option "3030 · Plate 4 x 10"
              - option "3031 · Plate 4 x 4"
              - option "3032 · Plate 4 x 6"
              - option "3033 · Plate 6 x 10"
              - option "3034 · Plate 2 x 8"
              - option "3035 · Plate 4 x 8"
              - option "3036 · Plate 6 x 8"
              - option "3038 · Slope Brick 45 2 x 3"
              - option "3039 · Slope Brick 45 2 x 2"
              - option "3041 · Slope Brick 45 2 x 4 Double"
              - option "3460 · Plate 1 x 8"
              - option "3622 · Brick 1 x 3"
              - option "3641 · Tyre 6/ 50 x 8 Offset Tread"
              - option "3666 · Plate 1 x 6"
              - option "3673 · Technic Pin"
              - option "3700 · Technic Brick 1 x 2 with Hole"
              - option "3710 · Plate 1 x 4"
              - option "3795 · Plate 2 x 6"
              - option "3832 · Plate 2 x 10"
              - option "3958 · Plate 6 x 6"
              - option "4070 · Brick 1 x 1 with Headlight"
              - option "4079 · Minifig Seat 2 x 2"
              - option "4162 · Tile 1 x 8"
              - option "4282 · Plate 2 x 16"
              - option "4477 · Plate 1 x 10"
              - option "4600 · Plate 2 x 2 with 2 Wheel Pins"
              - option "4624 · Wheel Rim 6.4 x 8"
              - option "6111 · Brick 1 x 10"
              - option "6636 · Tile 1 x 6"
              - option "11211 · Brick 1 x 2 with Two Studs on One Side"
              - option "11212 · Plate 3 x 3"
              - option "11477 · Slope Brick Curved 2 x 1"
              - option "14769 · Tile 2 x 2 Round with Round Underside Stud"
              - option "15068 · Slope Brick Curved 2 x 2 x 0.667"
              - option "15573 · Plate 1 x 2 with Groove with 1 Centre Stud, without Understud"
              - option "18973 · Windscreen 6 x 4 x 1.333 Curved"
              - option "18974 · Car Mudguard 4 x 2.5 x 2.333"
              - option "18975 · Plate 2 x 4 with Side Bricks 1 x 2 x 1.333 with Hole"
              - option "18976 · Wheel Rim 11 x 18 with Vented Disc Brake"
              - option "18977 · Tyre 11.2/ 28 x 17.6 Intermediate"
              - option "24299 · Wing 2 x 2 Left"
              - option "24307 · Wing 2 x 2 Right"
              - option "26603 · Tile 2 x 3"
              - option "29119 · Slope Brick Curved 2 x 1 with Cutout Right"
              - option "29120 · Slope Brick Curved 2 x 1 with Cutout Left"
              - option "35789 · Car Mudguard 4 x 2.5 x 2 with Rounded Ends"
              - option "41769 · Wing 2 x 4 Right"
              - option "41770 · Wing 2 x 4 Left"
              - option "43722 · Wing 2 x 3 Right"
              - option "43723 · Wing 2 x 3 Left"
              - option "47905 · Brick 1 x 1 with Studs on Two Opposite Sides"
              - option "50950 · Slope Brick Curved 3 x 1"
              - option "52107 · Brick 1 x 2 with Studs on Sides"
              - option "54200 · Slope Brick 31 1 x 1 x 0.667"
              - option "62360 · Windscreen 3 x 6 x 1 Curved"
              - option "63864 · Tile 1 x 3"
              - option "65632 · Windscreen 6 x 6 x 1.667 Curved"
              - option "65633 · Windscreen 6 x 6 x 1.333 Angled Curved"
              - option "65635 · Plate 2 x 6 with Side Bricks 1 x 2 x 1.333 with Axlehole"
              - option "66727 · Wheel Rim 11 x 18 with Drilled Disc Brake"
              - option "85984 · Slope Brick 31 1 x 2 x 0.667"
              - option "87079 · Tile 2 x 4 with Groove"
              - option "87087 · Brick 1 x 1 with Stud on 1 Side"
              - option "87552 · Panel 1 x 2 x 2 Reinforced"
              - option "87580 · Plate 2 x 2 with Groove with 1 Centre Stud"
              - option "91988 · Plate 2 x 14"
              - option "98138 · Tile 1 x 1 Round with Groove"
              - option "98282 · Car Mudguard 4 x 2.5 x 1"
              - option "99206 · Plate 2 x 2 x 0.667 with Two Studs On Side and Two Raised with Closed Understud"
              - option "99207 · Bracket 1 x 2 - 2 x 2 Up"
              - option "99780 · Bracket 1 x 2 - 1 x 2 Up"
              - option "99781 · Bracket 1 x 2 - 1 x 2 Down"
              - option "3023b · Plate 1 x 2"
              - option "3068b · Tile 2 x 2 with Groove"
              - option "3069b · Tile 1 x 2 with Groove"
              - option "3070b · Tile 1 x 1 with Groove" [selected]
              - option "3794b · Plate 1 x 2 with Groove with 1 Centre Stud"
              - option "3040b · Slope Brick 45 2 x 1"
              - option "2412b · Tile 1 x 2 Grille with Groove"
              - option "10312 · Windscreen 6 x 10 x 3 with 1 x 2 x 1 Cutout - Ovoid"
              - option "103918 · Windscreen 4 x 4 x 2 with Integral Glass"
              - option "11289 · Windscreen 4 x 4 x 4.667 Canopy with Handle"
              - option "13252 · Windscreen 6 x 13 x 2"
              - option "13760 · Windscreen 2 x 6 x 2 Frame"
              - option "16477 · Windscreen 16 x 8 x 6 Curved with 3 Pin Holes"
              - option "17454 · Windscreen 2 x 6 x 2 Vertical Frame"
              - option "17457 · Windscreen 2 x 6 x 2 Vertical Glass"
              - option "18591 · Windscreen 4 x 4 x 5 Cone with Pins"
              - option "18729 · Windscreen 6 x 10 x 4 Curved"
              - option "1874 · Windscreen 9 x 6 x 1.667"
              - option "18972 · Windscreen 5 x 4 x 1.667 Curved"
              - option "18990 · Windscreen 4 x 4 x 1.667 Canopy Half Sphere with Handle Bar"
              - option "19212 · Windscreen 1 x 12 x 4 Trapezoidal"
              - option "20455 · Windscreen 9 x 4 x 7 Hemisphere with 4 Hollow Studs on Top"
              - option "20684 · Windscreen 3 x 8 x 3"
              - option "21 · Windscreen 2 x 4 x 1 & 2/3"
              - option "21849 · Windscreen 8 x 4 x 2 with Handle and 2 Studs"
              - option "22483 · Windscreen 6 x 4 x 1.333 Pointed"
              - option "2337 · Windscreen 4 x 4 x 2 Canopy Extender"
              - option "23448 · Windscreen 8 x 4 x 2 Curved with Handle"
              - option "2352 · Windscreen 2 x 4 x 3"
              - option "2418a · Windscreen 6 x 6 Octagonal Canopy without Axlehole"
              - option "1846 · Car Mudguard 4 x 3 x 1.667"
              - option "24151 · Car Mudguard 4 x 4"
              - option "2513 · Car Mudguard 3 x 4"
              - option "28326 · Car Mudguard 4 x 3 x 1"
              - option "3787 · Car Mudguard 2 x 4 without Studs"
              - option "3788 · Car Mudguard 2 x 4"
              - option "41854 · Car Mudguard 2 x 4 Swept Back"
              - option "44674 · Car Mudguard 3 x 4 Overhanging"
              - option "49097 · Car Mudguard 3 x 2.5 x 1"
              - option "50745 · Car Mudguard 4 x 2.5 x 2"
              - option "50947 · Car Mudguard 4.5 x 1 x 1"
              - option "60212 · Car Mudguard 2 x 4 with Central Hole"
              - option "62361 · Car Mudguard 6 x 1.5 x 1 with Arch"
              - option "80567 · Vehicle Mudguard 4 x 10 x 0.667"
              - option "93587 · Car Mudguard 3 x 4 x 1.667 Curved"
              - option "93590 · Car Mudguard 2 x 4 with Headlights and Curved Fenders"
              - option "93597 · Car Mudguard 3 x 4 x 1.333 Curved with Headlights"
              - option "98835 · Car Mudguard 3 x 4 x 1.667 with Curved Front"
              - option "11215 · Bracket 5 x 2 x 1.333"
              - option "14520 · Bracket 2 x 4 x 0.667 with Front Studs and Deep Arches"
              - option "18671 · Bracket 3 x 2 x 1.333"
              - option "18986 · Bracket 1 x 1 - 1 x 2"
              - option "2422 · Bracket 2 x 2 - 1 x 4"
              - option "2436a · Bracket 1 x 2 - 1 x 4 with Square Corners"
              - option "2436b · Bracket 1 x 2 - 1 x 4 with Rounded Corners"
              - option "28802 · Bracket 1 x 2 - 1 x 4 with Rounded Bottom Corners"
              - option "28964 · Bracket 5 x 2 x 2.333 with Inside Fillets with Reinforced Bottom"
              - option "28974a · Bracket 1 x 1 - 1 x 1 Thick with Stud Hole"
              - option "30209 · Bracket 1 x 2 - Dish 4 x 4"
              - option "30250 · Bracket 4 x 7 x 3"
              - option "30263 · Bracket 6 x 12 x 1.333"
              - option "36840 · Bracket 1 x 1 - 1 x 1 Up"
              - option "36841 · Bracket 1 x 1 - 1 x 1 Down"
              - option "3956 · Bracket 2 x 2 - 2 x 2 Up"
              - option "41682 · Bracket 2 x 2 - 1 x 2 Up Centred"
              - option "42446 · Bracket 1 x 1 - 1 x 1 Thin with Stud Hole"
              - option "44728 · Bracket 1 x 2 - 2 x 2 Down"
              - option "4585 · Bracket 2 x 1 - 2 x 1 Up Centred"
              - option "4598 · Bracket 2 x 3 - 2 x 2"
              - option "4732 · Bracket 8 x 2 x 1 & 1/3"
              - option "48724 · Bracket 1 x 1 - 1 x 1 with Pin"
              - option "5090 · Bracket 1 x 6 with 1 x 4 Cutout - 2x 6 Up"
              - option "5175 · Bracket 2 x 4 - 1 x 4 Down"
              - option "52038 · Bracket 2 x 4 x 0.667 with Front Studs and Shallow Arches"
              - option "5712 · Bracket 5 x 1 x 1.333"
              - option "6087 · Bracket 5 x 2 x 2.333 with Inside Rib"
              - option "64570 · Bracket 2 x 6 - 1 x 6 Up with Rounded Corners"
              - option "65132 · Bracket 4 x 5 x 5 with 4 Locking Hinges with 2 Fingers, Four Studs and 12 Studs on Back"
              - option "69906 · Bracket 3 x 2 - 2 x 2 Down with Rounded Brace"
              - option "73562 · Bracket 3 x 2 x 1.333 with Bottom Stud Holder"
              - option "73825 · Bracket 1 x 1 - 2 x 1 Up"
              - option "76766 · Bracket 5 x 2 x 2.333 with Inside Fillets"
              - option "79389 · Bracket 1 x 1 - 2 x 1 Down"
              - option "93274 · Bracket 1 x 2 - 2 x 4"
              - option "98287 · Bracket 3 x 4 - 3 x 4 Up"
              - option "11290 · Slope Brick Curved 2 x 8 x 2 Double"
              - option "11301 · Slope Brick Curved 2 x 8 x 2 Inverted Double"
              - option "13547 · Slope Brick Curved 4 x 1 Inverted"
              - option "15625 · Slope Brick Curved 5 x 8 x 0.667"
              - option "24201 · Slope Brick Curved 2 x 1 Inverted"
              - option "24309 · Slope Brick Curved 3 x 2"
              - option "30602 · Slope Brick Curved Top 2 x 2 x 1"
              - option "32803 · Slope Brick Curved 2 x 2 Inverted"
              - option "41766 · Slope Brick Curved 8 x 2 x 2"
              - option "42022 · Slope Brick Curved 6 x 1"
              - option "42023 · Slope Brick Curved 6 x 1 Inverted"
              - option "42918 · Slope Brick Curved 8 x 2"
              - option "44126 · Slope Brick Curved 6 x 2"
              - option "44675 · Slope Brick Curved Top 2 x 2 x 1 with Dimples"
              - option "45410 · Slope Brick Curved 6 x 8 x 2 Inverted Double"
              - option "45411 · Slope Brick Curved 6 x 8 x 2 Double"
              - option "47456 · Slope Brick Curved 2 x 3 x 0.667 with Fin and 2 Studs"
              - option "47457 · Slope Brick Curved 2 x 2 x 2/3 Triple with Two Top Studs"
              - option "47458 · Slope Brick Curved 1 x 2 x 2/3 with Fin without Studs"
              - option "50967 · Slope Brick Curved 8 x 1 x 1 & 2/3 with Arch"
              - option "54091 · Slope Brick Curved 8 x 8 x 2 Inverted Double"
              - option "54095 · Slope Brick Curved 8 x 8 x 2 Double"
              - option "54096 · Slope Brick Curved 8 x 8 x 2 Double with Cutout"
              - option "56204 · Slope Brick Curved 6 x 8 x 2 Double"
              - option "61068 · Slope Brick Curved 2 x 4 without Underside Studs"
              - option "61487 · Slope Brick Curved 4 x 4 x 2"
              - option "61678 · Slope Brick Curved 4 x 1"
              - option "66955 · Slope Brick Curved 4 x 3.5 x 1 with 3 Steps"
              - option "66956 · Slope Brick Curved 2 x 2 with Double Cutout"
              - option "70681 · Slope Brick Curved 1 x 3 with 1 x 2 Inverted Cutout"
              - option "71771 · Slope Brick Curved 5 x 8 x 0.667 without Studs"
              - option "80177 · Slope Brick Curved 3 x 2 with Cutout Left"
              - option "80178 · Slope Brick Curved 3 x 2 with Cutout Right"
              - option "85970 · Slope Brick Curved 1 x 8 with Plate 1 x 2"
              - option "88930 · Slope Brick Curved 2 x 4 with Underside Studs"
              - option "93273 · Slope Brick Curved 4 x 1 Double"
              - option "93589 · Slope Brick Curved Tapered 4 x 2 on Plate 1 x 4"
              - option "93604 · Slope Brick Curved 3 x 4 x 0.667 Rounded"
              - option "93606 · Slope Brick Curved 4 x 2"
              - option "11291 · Wedge 3 x 4 x 0.667 Cutout"
              - option "13349 · Wedge 4 x 4 Triple Inverted with Ribs between Studs"
              - option "22390 · Wedge 6 x 8 Double with Cutout"
              - option "22391 · Wedge 4 x 4 Pointed"
              - option "2336 · Wedge 2 x 3 with Brick 2 x 4 Side Studs and Plate 2 x 2"
              - option "2399 · Wedge 3 x 4"
              - option "29115 · Wedge 6 x 6 Triple Inverted"
              - option "2916 · Wedge 4 x 6 x 2.333"
              - option "30382 · Wedge 2 x 12 Triple"
              - option "32084 · Wedge 6 x 8 Triple with Cutout 4 x 4"
              - option "41747 · Wedge 2 x 6 Double Right"
              - option "41748 · Wedge 2 x 6 Double Left"
              - option "41761 · Wedge 6 x 8 x 2 Triple Inverted"
              - option "41764 · Wedge 2 x 6 Double Inverted Right"
              - option "41765 · Wedge 2 x 6 Double Inverted Left"
              - option "41767 · Wedge 4 x 2 Right"
              - option "41768 · Wedge 4 x 2 Left"
              - option "42021 · Wedge 6 x 8 x 2 Triple Inverted"
              - option "42060 · Wedge 12 x 3 x 1 Double Rounded Right"
              - option "42061 · Wedge 12 x 3 x 1 Double Rounded Left"
              - option "42862 · Wedge 3 x 3 Sloped Left"
              - option "43710 · Wedge 4 x 2 Double Left"
              - option "43711 · Wedge 4 x 2 Double Right"
              - option "43712 · Wedge 6 x 4 Triple Curved"
              - option "48729b · Bar 1.5L with Clip with Truncated Sides and Hole in Shaft"
              - option "60470b · Plate 1 x 2 with 2 Clips Horizontal (Thick C-Clips)"
              - option "30374 · Bar 4L Lightsaber Blade"
              - option "32000 · Technic Brick 1 x 2 with Holes"
              - option "3623 · Plate 1 x 3"
              - option "60479 · Plate 1 x 12"
              - option "78329 · Plate 1 x 5"
              - option "3456 · Plate 6 x 14"
              - option "69729 · Tile 2 x 6"
              - option "6934 · Tile 3 x 6"
              - option "41539 · Plate 8 x 8"
              - option "3062b · Brick 1 x 1 Round with Hollow Stud"
          - generic [ref=e160]:
            - generic [ref=e161]: Connection B
            - combobox "Connection B" [ref=e162]:
              - option "已开放 · parts/s/3070bs01.dat:8:0 · cylinder · F · (0, 8, 0)" [selected]
              - option "已开放 · parts/3070b.dat:8:1 · cylinder · F · (0, 8, 0)"
        - generic [ref=e163]:
          - generic [ref=e164]:
            - generic [ref=e165]: 连接轴上的离散旋转
            - combobox "选择装配旋转" [ref=e166]:
              - option "0°" [selected]
              - option "90°"
              - option "180°"
              - option "270°"
          - button "Auto Attach" [ref=e167] [cursor=pointer]
      - alert [ref=e171]:
        - generic [ref=e175]: 请选择受支持的基础结构，零件数量应为 3–32。
      - generic [ref=e176]:
        - heading "待装配零件" [level=3] [ref=e178]
        - generic [ref=e179]:
          - generic [ref=e180]:
            - checkbox "连接点与法线" [checked] [ref=e181]
            - text: 连接点与法线
          - generic "取得装配结果及实际碰撞代理后可显示。" [ref=e182]:
            - checkbox "碰撞代理" [disabled] [ref=e183]
            - text: 碰撞代理
          - generic [ref=e184]:
            - checkbox "连接轴与插入路径" [checked] [ref=e185]
            - text: 连接轴与插入路径
          - generic [ref=e186]:
            - checkbox "合法插入区" [ref=e187]
            - text: 合法插入区
        - generic [ref=e188]:
          - generic [ref=e189]:
            - generic [ref=e190]: A · 固定零件原始坐标
            - generic [ref=e191]:
              - img "LDraw 原生零件三维视图，可拖动旋转、滚轮缩放" [ref=e193]
              - generic: 拖动旋转 · 滚轮缩放 · 可查看底部
              - button "重置三维视角" [ref=e194] [cursor=pointer]: 重置视角
          - generic [ref=e198]:
            - generic [ref=e199]: B · 待装配零件原始坐标
            - generic [ref=e200]:
              - img "LDraw 原生零件三维视图，可拖动旋转、滚轮缩放" [ref=e202]
              - generic: 拖动旋转 · 滚轮缩放 · 可查看底部
              - button "重置三维视角" [ref=e203] [cursor=pointer]: 重置视角
        - paragraph [ref=e207]: 展示颜色用于区分实例。装配前分别以原始坐标预览；橙色线框来自后端实际闭合碰撞代理。插入路径显示求解器给出的方向，具体验证范围以检查记录为准。
        - generic [ref=e208]:
          - paragraph [ref=e209]:
            - strong [ref=e210]: A 来源连接
            - generic [ref=e211]: stud · M · 位置 [0, 0, 0]
            - generic [ref=e212]: p/stud.dat:8
          - paragraph [ref=e213]:
            - strong [ref=e214]: B 来源连接
            - generic [ref=e215]: cylinder · F · 位置 [0, 8, 0]
            - generic [ref=e216]: parts/s/3070bs01.dat:8
      - generic [ref=e217]:
        - generic [ref=e223]:
          - heading "真实基础结构生成" [level=2] [ref=e224]
          - paragraph [ref=e225]: 只使用当前获得生成准入的零件与连接；信息不足时返回具体阻塞原因。表面合同模块显式选择开壳外表面检查：只检查最终姿态的真实表面交叉与来源 seat 接触，不认证闭合实体、厚度、承重、安装路径或实物。
        - generic [ref=e226]:
          - generic [ref=e227]: 生成时包含的零件（可选）
          - combobox "生成时包含的零件" [ref=e228]:
            - option "自动选件"
            - option "2431 · Tile 1 x 4 with Groove"
            - option "2445 · Plate 2 x 12"
            - option "2456 · Brick 2 x 6"
            - option "3001 · Brick 2 x 4"
            - option "3002 · Brick 2 x 3"
            - option "3003 · Brick 2 x 2"
            - option "3004 · Brick 1 x 2"
            - option "3005 · Brick 1 x 1"
            - option "3006 · Brick 2 x 10"
            - option "3008 · Brick 1 x 8"
            - option "3009 · Brick 1 x 6"
            - option "3010 · Brick 1 x 4"
            - option "3020 · Plate 2 x 4"
            - option "3021 · Plate 2 x 3"
            - option "3022 · Plate 2 x 2"
            - option "3023 · ~Moved To 3023b"
            - option "3024 · Plate 1 x 1"
            - option "3026 · Plate 6 x 24"
            - option "3027 · Plate 6 x 16"
            - option "3028 · Plate 6 x 12"
            - option "3029 · Plate 4 x 12"
            - option "3030 · Plate 4 x 10"
            - option "3031 · Plate 4 x 4"
            - option "3032 · Plate 4 x 6"
            - option "3033 · Plate 6 x 10"
            - option "3034 · Plate 2 x 8"
            - option "3035 · Plate 4 x 8"
            - option "3036 · Plate 6 x 8"
            - option "3039 · Slope Brick 45 2 x 2"
            - option "3460 · Plate 1 x 8"
            - option "3622 · Brick 1 x 3"
            - option "3666 · Plate 1 x 6"
            - option "3673 · Technic Pin"
            - option "3710 · Plate 1 x 4"
            - option "3795 · Plate 2 x 6"
            - option "3832 · Plate 2 x 10"
            - option "3958 · Plate 6 x 6"
            - option "4070 · Brick 1 x 1 with Headlight"
            - option "4162 · Tile 1 x 8"
            - option "4282 · Plate 2 x 16"
            - option "4477 · Plate 1 x 10"
            - option "6111 · Brick 1 x 10"
            - option "6636 · Tile 1 x 6"
            - option "11211 · Brick 1 x 2 with Two Studs on One Side"
            - option "11212 · Plate 3 x 3"
            - option "15573 · Plate 1 x 2 with Groove with 1 Centre Stud, without Understud"
            - option "24299 · Wing 2 x 2 Left"
            - option "24307 · Wing 2 x 2 Right"
            - option "26603 · Tile 2 x 3"
            - option "47905 · Brick 1 x 1 with Studs on Two Opposite Sides"
            - option "54200 · Slope Brick 31 1 x 1 x 0.667"
            - option "63864 · Tile 1 x 3"
            - option "85984 · Slope Brick 31 1 x 2 x 0.667"
            - option "87079 · Tile 2 x 4 with Groove"
            - option "87087 · Brick 1 x 1 with Stud on 1 Side"
            - option "87552 · Panel 1 x 2 x 2 Reinforced"
            - option "87580 · Plate 2 x 2 with Groove with 1 Centre Stud"
            - option "91988 · Plate 2 x 14"
            - option "99207 · Bracket 1 x 2 - 2 x 2 Up"
            - option "99780 · Bracket 1 x 2 - 1 x 2 Up"
            - option "99781 · Bracket 1 x 2 - 1 x 2 Down"
            - option "3023b · Plate 1 x 2"
            - option "3068b · Tile 2 x 2 with Groove"
            - option "3069b · Tile 1 x 2 with Groove"
            - option "3070b · Tile 1 x 1 with Groove"
            - option "3794b · Plate 1 x 2 with Groove with 1 Centre Stud"
            - option "2412b · Tile 1 x 2 Grille with Groove"
            - option "13760 · Windscreen 2 x 6 x 2 Frame"
            - option "17454 · Windscreen 2 x 6 x 2 Vertical Frame"
            - option "18591 · Windscreen 4 x 4 x 5 Cone with Pins"
            - option "21 · Windscreen 2 x 4 x 1 & 2/3"
            - option "2352 · Windscreen 2 x 4 x 3"
            - option "28326 · Car Mudguard 4 x 3 x 1"
            - option "3788 · Car Mudguard 2 x 4"
            - option "41854 · Car Mudguard 2 x 4 Swept Back"
            - option "50947 · Car Mudguard 4.5 x 1 x 1"
            - option "60212 · Car Mudguard 2 x 4 with Central Hole"
            - option "2422 · Bracket 2 x 2 - 1 x 4"
            - option "28974a · Bracket 1 x 1 - 1 x 1 Thick with Stud Hole"
            - option "36840 · Bracket 1 x 1 - 1 x 1 Up"
            - option "41682 · Bracket 2 x 2 - 1 x 2 Up Centred"
            - option "42446 · Bracket 1 x 1 - 1 x 1 Thin with Stud Hole"
            - option "44728 · Bracket 1 x 2 - 2 x 2 Down"
            - option "4598 · Bracket 2 x 3 - 2 x 2"
            - option "5090 · Bracket 1 x 6 with 1 x 4 Cutout - 2x 6 Up"
            - option "5175 · Bracket 2 x 4 - 1 x 4 Down"
            - option "52038 · Bracket 2 x 4 x 0.667 with Front Studs and Shallow Arches"
            - option "69906 · Bracket 3 x 2 - 2 x 2 Down with Rounded Brace"
            - option "73825 · Bracket 1 x 1 - 2 x 1 Up"
            - option "93274 · Bracket 1 x 2 - 2 x 4"
            - option "98287 · Bracket 3 x 4 - 3 x 4 Up"
            - option "50967 · Slope Brick Curved 8 x 1 x 1 & 2/3 with Arch"
            - option "2399 · Wedge 3 x 4"
            - option "48729b · Bar 1.5L with Clip with Truncated Sides and Hole in Shaft"
            - option "60470b · Plate 1 x 2 with 2 Clips Horizontal (Thick C-Clips)"
            - option "30374 · Bar 4L Lightsaber Blade"
            - option "32000 · Technic Brick 1 x 2 with Holes"
            - option "3623 · Plate 1 x 3"
            - option "60479 · Plate 1 x 12"
            - option "78329 · Plate 1 x 5"
            - option "3456 · Plate 6 x 14"
            - option "69729 · Tile 2 x 6"
            - option "6934 · Tile 3 x 6"
            - option "41539 · Plate 8 x 8"
            - option "3062b · Brick 1 x 1 Round with Hollow Stud" [selected]
        - generic [ref=e229]:
          - generic [ref=e230]: 零件数量（可选，2–32；杆夹/销孔/表面合同模块固定 2，接口驱动组合至少 2，其他模块至少 3）
          - spinbutton "生成零件数量" [ref=e231]: "2"
        - generic [ref=e232]:
          - button "接口驱动组合" [ref=e233] [cursor=pointer]
          - button "墙体" [ref=e236] [cursor=pointer]
          - button "平台" [ref=e239] [cursor=pointer]
          - button "简单车架" [ref=e242] [cursor=pointer]
          - button "箱体" [ref=e245] [cursor=pointer]
          - button "屋顶" [ref=e248] [cursor=pointer]
          - button "SNOT 模块" [ref=e251] [cursor=pointer]
          - button "轮组模块" [ref=e254] [cursor=pointer]
          - button "杆夹模块" [ref=e257] [cursor=pointer]
          - button "销孔模块" [ref=e260] [cursor=pointer]
          - button "表面合同模块" [ref=e263] [cursor=pointer]
      - generic [ref=e266]:
        - generic [ref=e271]:
          - heading "重新导入真实装配模型" [level=2] [ref=e272]
          - paragraph [ref=e273]: 检查当前来源、规则版本、连接口与连接图。旧资格失效时返回 NEEDS_REVALIDATION。
        - generic [ref=e274]:
          - generic [ref=e275]:
            - generic [ref=e276]: 已导出的模型 JSON（最多 5 MiB）
            - button "选择真实装配模型 JSON" [ref=e277]
          - button "验证导入模型" [disabled] [ref=e278]
      - generic [ref=e282]:
        - generic [ref=e286]:
          - heading "零件接口与可选状态" [level=2] [ref=e287]
          - paragraph [ref=e288]: 语法可选、实际接口测试与完整模型装配结果分别记录。
        - generic [ref=e289]:
          - textbox "搜索装配迁移零件" [ref=e290]:
            - /placeholder: 按零件编号筛选
          - combobox "筛选装配验证状态" [ref=e291]:
            - option "全部结果" [selected]
            - option "语法可选零件"
            - option "有已保存装配证明"
            - option "当前不可选零件"
            - option "需要进一步核验"
            - option "尚无逐接口测试记录"
          - generic [ref=e292]: 254 个零件
        - table [ref=e294]:
          - rowgroup [ref=e295]:
            - row [ref=e296]:
              - columnheader "零件编号" [ref=e297]
              - columnheader "可选状态" [ref=e298]
              - columnheader "实际接口测试 PASS / 已发现" [ref=e299]
              - columnheader "逐接口测试记录" [ref=e300]
              - columnheader "语法候选" [ref=e301]
              - columnheader "原因 / 当前范围" [ref=e302]
          - rowgroup [ref=e303]:
            - row [ref=e304]:
              - cell "2431" [ref=e305]
              - cell "GRAMMAR_ELIGIBLE" [ref=e306]
              - cell "0 / 7 BLOCKED 0 · 待核验 0 · PENDING 7" [ref=e308]:
                - text: 0 / 7
                - generic [ref=e309]: BLOCKED 0 · 待核验 0 · PENDING 7
              - cell "尚无完整记录" [ref=e310]
              - cell "可选" [ref=e311]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e312]
            - row [ref=e313]:
              - cell "2445" [ref=e314]
              - cell "GRAMMAR_ELIGIBLE" [ref=e315]
              - cell "0 / 48 BLOCKED 0 · 待核验 0 · PENDING 48" [ref=e317]:
                - text: 0 / 48
                - generic [ref=e318]: BLOCKED 0 · 待核验 0 · PENDING 48
              - cell "尚无完整记录" [ref=e319]
              - cell "可选" [ref=e320]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e321]
            - row [ref=e322]:
              - cell "2456" [ref=e323]
              - cell "GRAMMAR_ELIGIBLE" [ref=e324]
              - cell "0 / 24 BLOCKED 0 · 待核验 0 · PENDING 24" [ref=e326]:
                - text: 0 / 24
                - generic [ref=e327]: BLOCKED 0 · 待核验 0 · PENDING 24
              - cell "尚无完整记录" [ref=e328]
              - cell "可选" [ref=e329]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e330]
            - row [ref=e331]:
              - cell "3001" [ref=e332]
              - cell "GRAMMAR_ELIGIBLE" [ref=e333]
              - cell "0 / 16 BLOCKED 0 · 待核验 0 · PENDING 16" [ref=e335]:
                - text: 0 / 16
                - generic [ref=e336]: BLOCKED 0 · 待核验 0 · PENDING 16
              - cell "尚无完整记录" [ref=e337]
              - cell "可选" [ref=e338]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e339]
            - row [ref=e340]:
              - cell "3002" [ref=e341]
              - cell "GRAMMAR_ELIGIBLE" [ref=e342]
              - cell "0 / 12 BLOCKED 0 · 待核验 0 · PENDING 12" [ref=e344]:
                - text: 0 / 12
                - generic [ref=e345]: BLOCKED 0 · 待核验 0 · PENDING 12
              - cell "尚无完整记录" [ref=e346]
              - cell "可选" [ref=e347]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e348]
            - row [ref=e349]:
              - cell "3003" [ref=e350]
              - cell "GRAMMAR_ELIGIBLE" [ref=e351]
              - cell "0 / 9 BLOCKED 0 · 待核验 0 · PENDING 9" [ref=e353]:
                - text: 0 / 9
                - generic [ref=e354]: BLOCKED 0 · 待核验 0 · PENDING 9
              - cell "尚无完整记录" [ref=e355]
              - cell "可选" [ref=e356]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e357]
            - row [ref=e358]:
              - cell "3004" [ref=e359]
              - cell "GRAMMAR_ELIGIBLE" [ref=e360]
              - cell "0 / 5 BLOCKED 0 · 待核验 0 · PENDING 5" [ref=e362]:
                - text: 0 / 5
                - generic [ref=e363]: BLOCKED 0 · 待核验 0 · PENDING 5
              - cell "尚无完整记录" [ref=e364]
              - cell "可选" [ref=e365]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e366]
            - row [ref=e367]:
              - cell "3005" [ref=e368]
              - cell "GRAMMAR_ELIGIBLE" [ref=e369]
              - cell "0 / 2 BLOCKED 0 · 待核验 0 · PENDING 2" [ref=e371]:
                - text: 0 / 2
                - generic [ref=e372]: BLOCKED 0 · 待核验 0 · PENDING 2
              - cell "尚无完整记录" [ref=e373]
              - cell "可选" [ref=e374]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e375]
            - row [ref=e376]:
              - cell "3006" [ref=e377]
              - cell "GRAMMAR_ELIGIBLE" [ref=e378]
              - cell "0 / 40 BLOCKED 0 · 待核验 0 · PENDING 40" [ref=e380]:
                - text: 0 / 40
                - generic [ref=e381]: BLOCKED 0 · 待核验 0 · PENDING 40
              - cell "尚无完整记录" [ref=e382]
              - cell "可选" [ref=e383]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e384]
            - row [ref=e385]:
              - cell "3007" [ref=e386]
              - cell "BLOCKED" [ref=e387]
              - cell "0 / 32 BLOCKED 0 · 待核验 0 · PENDING 32" [ref=e389]:
                - text: 0 / 32
                - generic [ref=e390]: BLOCKED 0 · 待核验 0 · PENDING 32
              - cell "尚无完整记录" [ref=e391]
              - cell "不可选" [ref=e392]
              - cell "The source mesh has open/branched boundary chains. A separate exterior-shell surface proxy is available only when that placement contract is explicitly selected; this is not structural eligibility." [ref=e393]
            - row [ref=e394]:
              - cell "3008" [ref=e395]
              - cell "GRAMMAR_ELIGIBLE" [ref=e396]
              - cell "0 / 23 BLOCKED 0 · 待核验 0 · PENDING 23" [ref=e398]:
                - text: 0 / 23
                - generic [ref=e399]: BLOCKED 0 · 待核验 0 · PENDING 23
              - cell "尚无完整记录" [ref=e400]
              - cell "可选" [ref=e401]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e402]
            - row [ref=e403]:
              - cell "3009" [ref=e404]
              - cell "GRAMMAR_ELIGIBLE" [ref=e405]
              - cell "0 / 17 BLOCKED 0 · 待核验 0 · PENDING 17" [ref=e407]:
                - text: 0 / 17
                - generic [ref=e408]: BLOCKED 0 · 待核验 0 · PENDING 17
              - cell "尚无完整记录" [ref=e409]
              - cell "可选" [ref=e410]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e411]
            - row [ref=e412]:
              - cell "3010" [ref=e413]
              - cell "GRAMMAR_ELIGIBLE" [ref=e414]
              - cell "0 / 11 BLOCKED 0 · 待核验 0 · PENDING 11" [ref=e416]:
                - text: 0 / 11
                - generic [ref=e417]: BLOCKED 0 · 待核验 0 · PENDING 11
              - cell "尚无完整记录" [ref=e418]
              - cell "可选" [ref=e419]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e420]
            - row [ref=e421]:
              - cell "3020" [ref=e422]
              - cell "GRAMMAR_ELIGIBLE" [ref=e423]
              - cell "0 / 16 BLOCKED 0 · 待核验 0 · PENDING 16" [ref=e425]:
                - text: 0 / 16
                - generic [ref=e426]: BLOCKED 0 · 待核验 0 · PENDING 16
              - cell "尚无完整记录" [ref=e427]
              - cell "可选" [ref=e428]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e429]
            - row [ref=e430]:
              - cell "3021" [ref=e431]
              - cell "GRAMMAR_ELIGIBLE" [ref=e432]
              - cell "0 / 12 BLOCKED 0 · 待核验 0 · PENDING 12" [ref=e434]:
                - text: 0 / 12
                - generic [ref=e435]: BLOCKED 0 · 待核验 0 · PENDING 12
              - cell "尚无完整记录" [ref=e436]
              - cell "可选" [ref=e437]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e438]
            - row [ref=e439]:
              - cell "3022" [ref=e440]
              - cell "GRAMMAR_ELIGIBLE" [ref=e441]
              - cell "0 / 9 BLOCKED 0 · 待核验 0 · PENDING 9" [ref=e443]:
                - text: 0 / 9
                - generic [ref=e444]: BLOCKED 0 · 待核验 0 · PENDING 9
              - cell "尚无完整记录" [ref=e445]
              - cell "可选" [ref=e446]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e447]
            - row [ref=e448]:
              - cell "3023" [ref=e449]
              - cell "GRAMMAR_ELIGIBLE" [ref=e450]
              - cell "0 / 5 BLOCKED 0 · 待核验 0 · PENDING 5" [ref=e452]:
                - text: 0 / 5
                - generic [ref=e453]: BLOCKED 0 · 待核验 0 · PENDING 5
              - cell "尚无完整记录" [ref=e454]
              - cell "可选" [ref=e455]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e456]
            - row [ref=e457]:
              - cell "3024" [ref=e458]
              - cell "GRAMMAR_ELIGIBLE" [ref=e459]
              - cell "0 / 2 BLOCKED 0 · 待核验 0 · PENDING 2" [ref=e461]:
                - text: 0 / 2
                - generic [ref=e462]: BLOCKED 0 · 待核验 0 · PENDING 2
              - cell "尚无完整记录" [ref=e463]
              - cell "可选" [ref=e464]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e465]
            - row [ref=e466]:
              - cell "3026" [ref=e467]
              - cell "GRAMMAR_ELIGIBLE" [ref=e468]
              - cell "0 / 288 BLOCKED 0 · 待核验 0 · PENDING 288" [ref=e470]:
                - text: 0 / 288
                - generic [ref=e471]: BLOCKED 0 · 待核验 0 · PENDING 288
              - cell "尚无完整记录" [ref=e472]
              - cell "可选" [ref=e473]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e474]
            - row [ref=e475]:
              - cell "3027" [ref=e476]
              - cell "GRAMMAR_ELIGIBLE" [ref=e477]
              - cell "0 / 192 BLOCKED 0 · 待核验 0 · PENDING 192" [ref=e479]:
                - text: 0 / 192
                - generic [ref=e480]: BLOCKED 0 · 待核验 0 · PENDING 192
              - cell "尚无完整记录" [ref=e481]
              - cell "可选" [ref=e482]
              - cell "已有接口符合受支持规则，实际组合仍需装配检查。" [ref=e483]
        - button "查看全部 254 个结果" [ref=e484] [cursor=pointer]
      - group [ref=e485]:
        - generic "当前连接能力与限制" [ref=e486] [cursor=pointer]
      - generic [ref=e487]:
        - strong [ref=e488]: 当前限制
        - list [ref=e489]:
          - listitem [ref=e490]: Generation eligibility is derived from pinned source connectors, enabled reusable rules and reliable native collision geometry; no per-part mate fixture is required.
          - listitem [ref=e491]: Grammar eligibility is not an executed assembly PASS. Physical fixture counters remain zero; each generated or uploaded complete model is validated separately.
          - listitem [ref=e492]: Only C01 standard stud interfaces are enabled in the current native graph adapter. Other connector and joint families remain UNKNOWN or require their own sourced fit evidence.
          - listitem [ref=e493]: Mechanical stability, deformation, swept installation clearance and physical builds are not certified.
    - generic [ref=e494]:
      - heading "当前资料与验证范围" [level=2] [ref=e495]
      - paragraph [ref=e499]: 这里整理的是可追溯的资料和零件数据。PDF 的拼搭步骤可用于人工观察与核对，目前不自动还原整车三维模型，也不代表已经训练了生成模型。
      - list [ref=e500]:
        - listitem [ref=e501]: Element → Part / Design / 颜色映射来自固定版本的公开数据镜像，保留 source-observed；LDraw 跨编号关系仍需明确证据。
        - listitem [ref=e502]: 附录数量有页码依据；颜色映射尚未独立与 PDF 图像逐项核对，备用件属性及整套完整性仍未知。
        - listitem [ref=e503]: 接口语法资格只允许尝试对应源接口；每个生成布局仍须通过实际碰撞、占用和连接图验证，不代表已做实物或制造公差认证。
        - listitem [ref=e504]: 闭合原生代理用于实体碰撞检查；无法可靠闭合的几何、未知机械配合或未测接口均保留具体阻塞原因。
        - listitem [ref=e505]: 6572269.pdf 与 6592544.pdf 超过当前附件传输上限，未读取其内容。Porsche 77239 暂无已读取的本地说明书。
        - listitem [ref=e506]: 真实装配生成器先开放基础结构。旧版参数化生成与导出继续暂停；没有训练神经网络或将 PDF 自动还原为整车。
```

# Test source

```ts
  177 | test('generates source-bound wall and chassis modules and preserves unsupported wheel reasons', async ({ page }, testInfo) => {
  178 |   const report = await open(page);
  179 |   const entries = report.queue ?? report.entries ?? [];
  180 |   const allowed = new Set(entries.filter((entry) => entry.generatable).map((entry) => entry.partId));
  181 |   for (const label of ['墙体', '简单车架']) {
  182 |     const response = page.waitForResponse((item) => item.url().endsWith('/api/parts-foundation/assembly/generate') && item.request().method() === 'POST', { timeout: 120_000 });
  183 |     await page.getByRole('button', { name: label, exact: true }).click();
  184 |     const generation = await response;
  185 |     expect(generation.ok()).toBe(true);
  186 |     const result = await generation.json();
  187 |     expect(result.status).toBe('generated');
  188 |     expect(result.model.placements.length).toBeGreaterThan(1);
  189 |     expectConnectedAssembly(result.model);
  190 |     expectGrammarAssessment(result.model);
  191 |     expect(result.model.placements.every((placement: { partId: string }) => allowed.has(placement.partId))).toBe(true);
  192 |     for (const key of ['partLibraryVersion', 'assemblyEngineVersion', 'connectionRuleVersion', 'collisionVersion']) expect(typeof result.model[key]).toBe('string');
  193 |     await expectRealCanvas(page);
  194 |     await expect(page.locator('.assembly-result-heading')).toContainText('通过当前装配检查');
  195 |   }
  196 |   await page.locator('.assembly-result').screenshot({ path: testInfo.outputPath('native-chassis.png') });
  197 |   const wheelResponse = page.waitForResponse((item) => item.url().endsWith('/api/parts-foundation/assembly/generate') && item.request().method() === 'POST');
  198 |   await page.getByRole('button', { name: '轮组模块', exact: true }).click();
  199 |   const wheel = await (await wheelResponse).json();
  200 |   if ((report.counts.wheelModulesVerified ?? 0) === 0) {
  201 |     expect(wheel.status).toBe('blocked');
  202 |     expect(wheel.reasons.length).toBeGreaterThan(0);
  203 |     await expect(page.locator('.assembly-result-heading')).toContainText('本次未通过');
  204 |     await expect(page.locator('.assembly-reasons').first()).toContainText(wheel.reasons[0]);
  205 |   } else expect(['generated', 'blocked']).toContain(wheel.status);
  206 | });
  207 | 
  208 | test('imports exported real models through current validation and prevents export after version or occupancy invalidation', async ({ page }) => {
  209 |   await open(page);
  210 |   const generationResponse = page.waitForResponse((item) => item.url().endsWith('/api/parts-foundation/assembly/generate') && item.request().method() === 'POST');
  211 |   await page.getByRole('button', { name: '墙体', exact: true }).click();
  212 |   const generated = await (await generationResponse).json();
  213 |   expect(generated.status).toBe('generated');
  214 |   expectConnectedAssembly(generated.model);
  215 |   await expect(page.locator('.assembly-export-buttons').getByRole('button', { name: '模型 JSON', exact: true })).toBeEnabled();
  216 |   const download = page.waitForEvent('download');
  217 |   await page.locator('.assembly-export-buttons').getByRole('button', { name: '模型 JSON', exact: true }).click();
  218 |   const file = await download, filename = await file.path();
  219 |   expect(filename).not.toBeNull();
  220 |   const content = await readFile(filename!, 'utf8');
  221 |   const exported = JSON.parse(content);
  222 |   expectConnectedAssembly(exported);
  223 | 
  224 |   async function upload(raw: string) {
  225 |     await page.getByLabel('选择真实装配模型 JSON', { exact: true }).setInputFiles({ name: 'real-assembly.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
  226 |     const response = page.waitForResponse((item) => item.url().endsWith('/api/parts-foundation/assembly/models/import') && item.request().method() === 'POST');
  227 |     await page.getByRole('button', { name: '验证导入模型', exact: true }).click();
  228 |     const result = await response;
  229 |     expect(result.ok(), `${result.status()} ${await result.text()}`).toBe(true);
  230 |     return await result.json();
  231 |   }
  232 |   const imported = await upload(content);
  233 |   expect(imported.status).toBe('VALID');
  234 |   expect(imported.model.id).not.toBe(exported.id);
  235 |   expectConnectedAssembly(imported.model);
  236 |   await expect(page.locator('.assembly-import-status')).toContainText('VALID');
  237 |   await expect(page.locator('.assembly-export-buttons').getByRole('button', { name: '模型 JSON', exact: true })).toBeEnabled();
  238 | 
  239 |   const { contentSha256: _checksum, ...stale } = exported;
  240 |   stale.assemblyEngineVersion = 'outdated-engine-for-revalidation-test';
  241 |   const expired = await upload(JSON.stringify({ ...stale, contentSha256: createHash('sha256').update(JSON.stringify(stale)).digest('hex') }));
  242 |   expect(expired.status).toBe('NEEDS_REVALIDATION');
  243 |   expect(expired.model).toBeNull();
  244 |   expect(expired.reasons.length).toBeGreaterThan(0);
  245 |   await expect(page.locator('.assembly-import-status')).toContainText('NEEDS_REVALIDATION');
  246 |   await expect(page.locator('.assembly-export-buttons')).toHaveCount(0);
  247 | 
  248 |   const { contentSha256: _oldChecksum, ...occupied } = JSON.parse(content);
  249 |   occupied.edges.push({ ...occupied.edges[0], id: 'duplicate-source-endpoint-for-revalidation-test' });
  250 |   const duplicated = await upload(JSON.stringify({ ...occupied, contentSha256: createHash('sha256').update(JSON.stringify(occupied)).digest('hex') }));
  251 |   expect(duplicated.status).toBe('NEEDS_REVALIDATION');
  252 |   expect(duplicated.model).toBeNull();
  253 |   expect(duplicated.reasons.length).toBeGreaterThan(0);
  254 |   await expect(page.locator('.assembly-export-buttons')).toHaveCount(0);
  255 | });
  256 | 
  257 | test('mobile assembly mode keeps source controls, accepted rendering and debug data within the viewport', async ({ page }, testInfo) => {
  258 |   await page.setViewportSize({ width: 390, height: 844 });
  259 |   const report = await open(page);
  260 |   expect(report.defaultPair).not.toBeNull();
  261 |   await selectPair(page, report.defaultPair!);
  262 |   expect((await attach(page)).accepted).toBe(true);
  263 |   await expectRealCanvas(page);
  264 |   await page.getByRole('checkbox', { name: '连接轴与插入路径', exact: true }).check();
  265 |   await page.locator('.assembly-result-data').filter({ has: page.getByText('插入路径与可视化调试数据', { exact: true }) }).locator('summary').click();
  266 |   const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  267 |   expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
  268 |   await page.locator('.assembly-result').screenshot({ path: testInfo.outputPath('mobile-assembly.png') });
  269 | });
  270 | 
  271 | test('uses newly imported 3062b from the ordinary interface generator and reimports its exported model', async ({ page }) => {
  272 |   await open(page);
  273 |   await page.getByLabel('生成时包含的零件', { exact: true }).selectOption('3062b');
  274 |   await page.getByLabel('生成零件数量', { exact: true }).fill('2');
  275 |   const generatedResponse=page.waitForResponse(r=>r.url().endsWith('/api/parts-foundation/assembly/generate')&&r.request().method()==='POST');
  276 |   await page.getByRole('button',{name:'接口驱动组合',exact:true}).click();
> 277 |   const response=await generatedResponse;expect(response.ok()).toBe(true);
      |                                                                ^ Error: expect(received).toBe(expected) // Object.is equality
  278 |   const result=await response.json();expect(result.status,result.reasons?.join('; ')).toBe('generated');
  279 |   expect(result.model.placements.some((p:{partId:string})=>p.partId==='3062b')).toBe(true);
  280 |   expect(result.model.bom.some((p:{partId:string;quantity:number})=>p.partId==='3062b'&&p.quantity>0)).toBe(true);
  281 |   expect(result.model.steps).toHaveLength(2);expect(result.model.sourceSnapshot).toMatch(/^[a-f0-9]{64}$/);
  282 |   expect(result.model.sources.some((s:{path:string})=>s.path==='parts/3062b.dat')).toBe(true);
  283 |   await expectRealCanvas(page);
  284 |   const exported=await page.request.get(`/api/parts-foundation/assembly/models/${result.model.id}/export?format=json`);
  285 |   expect(exported.ok()).toBe(true);
  286 |   await page.getByLabel('选择真实装配模型 JSON',{exact:true}).setInputFiles({name:'native-3062b.json',mimeType:'application/json',buffer:await exported.body()});
  287 |   const importedResponse=page.waitForResponse(r=>r.url().endsWith('/api/parts-foundation/assembly/models/import')&&r.request().method()==='POST');
  288 |   await page.getByRole('button',{name:'验证导入模型',exact:true}).click();
  289 |   const imported=await (await importedResponse).json();expect(imported.status).toBe('VALID');
  290 |   expect(imported.model.placements.some((p:{partId:string})=>p.partId==='3062b')).toBe(true);
  291 |   await mkdir('artifacts/import-collision/screenshots',{recursive:true});
  292 |   await page.locator('.assembly-native-stage').screenshot({path:'artifacts/import-collision/screenshots/3062b-generation-reimport.png'});
  293 | });
  294 | 
```