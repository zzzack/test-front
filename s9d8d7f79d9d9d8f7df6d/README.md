# 海盐蓝治愈小屋 · 室内 3D 漫游

免构建单页应用。Three.js r170 via ESM importmap，无 npm、无打包步骤。

## 运行

必须用 **HTTP 服务** 打开（`main.js` 会 `fetch('./scene.config.json')`，`file://` 协议会被 CORS 拦截）：

```bash
# 任选其一
python3 -m http.server 5173
npx serve .
# Go（你的主力栈）
go run github.com/…/simplehttp   # 或 gin.Static("/", "./dist")
```

访问 `http://localhost:5173`。若坚持双击 `index.html`，程序会自动落到内置的 `FALLBACK_CONFIG`（一个 6×6m 兜底盒子房），不会白屏。

## 操作

| 平台 | 操作 |
| --- | --- |
| 桌面 | 点击画面锁定指针；`W/A/S/D` 移动，`Shift` 加速，鼠标转向，`Tab` 切换 漫游→俯瞰→单品，点击家具弹出信息卡，`Esc` 释放指针 |
| 移动 | 左下摇杆移动，右半屏拖拽转向，「快走」按钮加速，双指轻触切换视角，轻点家具查看详情 |
| 通用 | 右上小地图点房间名瞬移；左下面板切换地面 / 墙面 / 白天·黄昏·夜晚 / 画质 |

## 文件

```
index.html          UI、样式、importmap
main.js             渲染管线、程序化建模、碰撞、交互
scene.config.json   房间 / 墙体 / 材质 / 灯光 / 热点（唯一数据源）
```

改户型、改配色、改家具价格标签，**只动 `scene.config.json`**，不必碰代码。

## 接入真实资源（可选）

当前所有贴图与家具都是 Canvas / 基础几何体程序化生成的占位物。若要替换为实拍资产：

### 贴图

| 用途 | 格式 | 分辨率 | 命名 | 备注 |
| --- | --- | --- | --- | --- |
| 地板 basecolor | KTX2 (UASTC) | 2048² | `floor_wood_basecolor.ktx2` | 需 sRGB，四方连续 |
| 地板 normal | KTX2 (UASTC) | 2048² | `floor_wood_normal.ktx2` | 线性空间 |
| 地板 roughness | KTX2 (ETC1S) | 1024² | `floor_wood_rough.ktx2` | 单通道即可 |
| 墙 / 布艺 | KTX2 (ETC1S) | 1024² | `wall_salt_basecolor.ktx2` | 素色可省略贴图 |
| 环境光 HDRI | HDR / EXR | 2K 全景 | `env_day.hdr` | 会被 PMREM 预卷积，2K 足够 |
| 全景兜底 | JPG | 4096×2048 | `pano_living.jpg` | 若走 A 方案（360 全景） |

转换命令：`toktx --t2 --encode uastc --genmipmap out.ktx2 in.png`

### 模型

- 格式 glb，**Draco**（几何）+ **KTX2**（贴图）双压缩：`gltf-transform optimize in.glb out.glb --texture-compress ktx2`
- 单房间总面数 < 12 万，全屋 < 80 万
- 原点放在物体底面中心，+Z 为正面，单位 **米**
- 命名 `furn_<room>_<name>.glb`，如 `furn_living_sofa.glb`

接入点：在 `buildItem()` 增加 `case 'model'` 分支，用 `GLTFLoader` + `DRACOLoader` + `KTX2Loader` 加载，其余（懒加载、碰撞盒、热点信息卡）逻辑全部复用。

## 调试

- 帧率显示在左上角；性能不达标时前 45 帧后会自动关后处理与阴影，控制台会打印 `[quality]`。
- `renderer.info.render.calls` 可在控制台查 draw call。
- GTAO 在部分移动 GPU 上会报编译错误，代码已 try/catch 降级，控制台出现 `[GTAO] 不可用` 属预期行为。
- 穿墙问题多半是墙体没进 Octree：确认新加的墙挂在 `shellGroup` 下，并在构建后调用 `worldOctree.fromGraphNode(shellGroup)`。
- iOS Safari 不支持 Pointer Lock，代码走触屏分支，勿在桌面模拟器里测手机交互。

## 后续可扩展

1. 真实 glb 家具 + LOD（`THREE.LOD` 三档，8m / 16m 切换）
2. Lightmap 烘焙（Blender Cycles → 第二套 UV），静态间接光比 GTAO 真实且更省
3. 户型编辑器：拖拽墙体端点直接写回 `scene.config.json`
4. 报价单：热点信息卡的 price 汇总成清单，导出 PDF/Excel
5. WebXR：`renderer.xr.enabled = true` + VR 手柄传送
6. 多人同步：WebSocket 广播相机位姿，做「设计师带看」
