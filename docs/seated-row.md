# 坐姿划船侧面计数实验

从首页「坐姿划船 → 侧面计数 · 实验」或手动记录页进入，也可直接打开 `/#/lab/seated-row`。选择摄像头、本地视频，或播放 34 秒的内置 GO4IT 示范。双臂都可显示轨迹，一次计数始终跟随同一只可见手臂。结束后显示本组确认次数和可见帧比例。实验不写入训练历史、EXP 或课程研究数据。

## 判定

举例来说，当运动员朝向画面右侧，手腕先在肩部右方远处，接着向躯干拉回，最后重新向右伸臂，完成一次。画面朝左时用相反的方向。相机尽量固定在侧面，只让一人入镜。Full 模型负责姿态检测，划船专用状态机依据图像中的二维几何关系计数。

- 使用图像像素计算肘角和肢段长度，水平距离除以同一只手臂两段长度之和。初始伸臂需要肘角至少 140°，水平距离占臂长至少 0.55。
- 拉回时肘角至多 105°，水平距离缩短至少 0.22 臂长，同时肘部回到躯干附近、手腕在肩部下方。朝原方向再次伸臂才计数。两端需持续至少 60 ms。
- 肩、肘或腕关键点置信度低于 0.6、越界、收到不递增的时间戳、采样间隔超过 320 ms 或肩点突然跳变，都可能中断这次动作。自动追踪不识别人，也不能保证在多人镜头里锁住同一个人。可见帧比例衡量关键点可用性，不能直接推导计数准确率。
- 该实验未做个体 ROM 校准，不提供力量、速度、动作质量评分或医疗结论。

## 冻结时窗及首次回放

一位标注者先按 2 Hz 查看原始画面，记录向前还原的时间区间。初始三个动作来源涵盖三名示范者，YMove 复制的后半段不再用作独立参考。官方模型未训练。固定回放为 15 Hz PNG、最长边 640 像素、Chrome 无头浏览器、CPU Full。原始时窗、来源、许可、截取和 SHA-256 见[原始清单](results/seated-row-sources.json)。

| 来源与画面 | 参考完整次数 | 固定帧匹配 | 多计 | 可见帧 |
| --- | ---: | ---: | ---: | ---: |
| YMove，侧面器械划船，首个完整动作 | 1 | 1 | 0 | 100% |
| GO4IT，侧后方连续训练，教练在后方 | 8 | 7 | 0 | 99.8% |
| USMC，弹力带坐姿划船，预先取双画面中的侧视图 | 5 | 2 | 0 | 99.4% |
| 错误动作对照，高位下拉前 8 秒 | 0 | 0 | 0 | 100% |

三个正例来源总计 10/14。所有计数均与一个人工时窗一对一匹配。GO4IT 固定帧漏掉第一下，USMC 漏掉五下中的三下。USMC 结果尤其说明，即使手臂几乎一直可见，动作也可能计少。[最终记录](results/seated-row-comparison.json)

## 独立来源及一次修正

随后检查三段新 Pexels 素材。手部特写和从后方拍摄且受遮挡的画面均应暂缓判断，二者实际训练者的完整次数无法从这个视角标定。第三个视频网页将动作标成划船，但人把手提至额头，肘部一直在身体前方，不符合本实验的拉至躯干动作。初版在 9.067 秒多计一次。加入上臂回收到躯干附近、手腕低于肩部的判据后，三个样本均为零次，上表各个时窗结果相同。该误判片已经参与修正，只能作为回归样本。[初版与原始浏览器记录](results/seated-row-initial.json) · [三段来源和观察依据](results/seated-row-holdout-sources.json) · [修正后记录](results/seated-row-holdout.json)

## 终版冻结后的第四位运动员

终版算法 SHA-256 以 `45f160d39d` 开头。冻结后找到 Tima Miroshnichenko 拍摄的另一位男性训练者，人工先标注连续 4 个完整拉回与还原动作。机位斜向拍摄上半身，手在伸直时贴近并多次越出画面边缘。固定回放的 267 帧中，关键点可用率 53.9%，确认 0/4，多计 0。这个结果保留原样，没有围绕该片调整阈值。合计四位真实训练者的正例是 **10/18**，四位的逐人结果为 1/1、7/8、2/5、0/4。实验要求展示手臂全过程，也仍会在关节可见的情况下漏计。[独立人工时窗](results/seated-row-unseen-sources.json) · [首次终版回放](results/seated-row-unseen.json) · [原视频](https://www.pexels.com/video/a-man-working-out-inside-the-gym-5319750/)

## 浏览器实测

真实页面通过首页、手动记录页及研究模式排除检查。GO4IT 内置视频按原速播放，最终浏览器运行看到双侧轨迹，8 个计数均落入 8 个参考时窗。浏览器回放使用展示帧与实时推理，和离线 15 Hz 的采样序列不同。本地文件选择器播放完整 YMove 文件，确认 2 次，两次是同段示范的重复。退出文件时 Blob URL 被回收。使用 Chrome 模拟摄像头，返回首页后媒体轨道已结束。测试会话的浏览器存储前后一致，没有页面异常。真人现场机位尚未实测。[浏览器验收结果](results/seated-row-browser.json)

## 复现

在 `ui/` 安装项目依赖并启动本地 Vite 开发服务器。FFmpeg 和 Playwright Chrome 用于固定帧回放，用户的摄像头和本地视频在浏览器内处理。其他来源仅下载到忽略的本地测试目录。浏览器验收可用 `FITPAL_CHROME` 指定 Chrome，若 Playwright 安装在其他位置可用 `FITPAL_PLAYWRIGHT` 指定其模块路径。

```sh
npm run setup:pose
python3 scripts/fetch-replay-assets.py --seated-row
npm run dev
```

在另一终端运行下列命令。可为浏览器验收额外传入 `--record ./本地演示.mp4`，导出有出处署名的真实实时页面录像。

```sh
node scripts/check-seated-row.mjs
node scripts/check-seated-row.mjs --holdout
node scripts/check-seated-row.mjs --unseen
node scripts/check-row-lab.mjs --output ../docs/results/seated-row-browser.json
npm test -- src/perception/seatedRow.test.ts
```

内置节选取自 Health TV 的 GO4IT 第 47 集，使用 Commons 240p 版本中 53:51–54:25，已去音轨并转为 MP4，按 CC BY 3.0 署名。USMC 素材由 Capt. Matthew Holfinger 拍摄，DVIDS 标注为公共领域。其他素材的具体权利及来源位于相应清单。[完整内置媒体署名](../ui/public/showcase/CREDITS.txt) · [USMC 原始页面](https://www.dvidshub.net/video/640249/seated-band-row) · [YMove 视频使用条款](https://github.com/ymove-app/exercise-api/tree/main/free-videos) · [Pexels 使用条款](https://www.pexels.com/license/)
