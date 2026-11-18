# 婚礼请帖 · 两版设计 + 回执后台

> 2026 年 12 月 20 日晚 · 杭州嘉宝丽酒店（杭州市上城区杭海路 601 号）

纯静态页面 + 一个**零依赖 Node 后台**（不需要 `npm install`，不需要数据库）。两版请帖任选其一发给宾客，回执自动进后台，你能随时看「预计出席多少人」并导出 Excel。

```
wedding-invite/
├── index.html      版本选择页（两版并排预览，方便你自己挑）
├── classic.html    版本一：优雅常规版（米白宣纸 + 宋体 + 香槟金）
├── stardew.html    版本二：星露谷像素版（黄昏农场 + 像素 UI + 邮筒回执）
├── server.js       ★ 回执后台（零依赖，Node 18+）
├── package.json    只有一条 start 命令
├── share.jpg       （待你放）微信分享缩略图，500×500 或 5:4
├── data/           后台自动创建：rsvp.json（原始数据）+ rsvp.csv（Excel）
└── README.md       本文件
```

---

## 一、本地跑起来（1 分钟）

装了 Node 18+ 的话，在这个目录下：

```bash
node server.js
```

控制台会打印四个地址：

| 地址 | 说明 |
|---|---|
| `http://localhost:8080/` | 请帖入口（选版本） |
| `http://localhost:8080/classic.html` | 优雅常规版 |
| `http://localhost:8080/stardew.html` | 星露谷像素版 |
| `http://localhost:8080/admin?token=xxxx` | **回执统计后台**（口令每次启动随机生成，看控制台） |

想固定口令（推荐，不然每次重启链接会变）：

```bash
# macOS / Linux
ADMIN_TOKEN=mysecret2026 node server.js

# Windows PowerShell
$env:ADMIN_TOKEN="mysecret2026"; node server.js
```

> 注意：**请帖页面要通过这个本地服务（或线上地址）打开**，不要再双击 HTML 文件。双击打开时没有 `/api/rsvp`，回执会自动降级成「复制文字」模式。

### 后台能看到什么

- **预计出席总人数**（每份回执填的人数累加；选「4 位及以上」按 4 人算）
- 出席回执份数 / 遗憾缺席数 / 回执总数
- 名单表：提交时间、姓名、出席、人数、联系方式、留言忌口
- **导出 Excel（CSV）** 一键下载，带 BOM，Excel 打开不乱码
- 单条删除（同名回执自动合并，宾客改主意重填不会重复计数）

数据存在 `data/rsvp.json` 里，纯文本，随时可以复制备份。

### 想让自己手机「叮」一下就收到回执（可选）

后台支持把每条回执推送到群机器人。在钉钉/飞书/企业微信群里加一个「自定义机器人」，拿到 webhook 地址：

```bash
WEBHOOK_URL="https://oapi.dingtalk.com/robot/send?access_token=xxx" WEBHOOK_TYPE=dingtalk node server.js
# 飞书：WEBHOOK_TYPE=feishu
# 企业微信：WEBHOOK_TYPE=wecom
```

这样每来一份回执，群里就有条消息，不用一直开后台。

---

## 二、上线（要在微信里打开，必须先有 https 链接）

你目前没有域名和服务器，按「从快到稳」排三条路：

### 路线 A：Render 免费部署（今天就能用，不花钱）

1. 注册 GitHub，把 `wedding-invite` 整个文件夹传成一个仓库（网页上传即可）
2. 注册 [render.com](https://render.com) → New → **Web Service** → 连这个仓库
3. Runtime 选 **Node**，Build Command 留空，Start Command 填 `node server.js`
4. 环境变量加一条 `ADMIN_TOKEN=你的口令`
5. 部署完拿到 `https://xxx.onrender.com`，微信里可以直接发这个链接

⚠️ 两个必读：
- **免费实例 15 分钟没人访问会休眠**，第一个打开的人要等 30～50 秒（发出去前先自己访问一次唤醒它）
- **免费实例磁盘是临时的**，重新部署/重启可能清空 `data/`。所以：① 配上群机器人推送（上一节），② 隔几天点一次「导出 Excel」，③ 想彻底解决就升级 Render Disk 或走路线 B

### 路线 B：国内云服务器（最稳，配好域名后微信体验最好）

腾讯云 / 阿里云轻量应用服务器（新用户常有百元内首年档位）：

1. 装 Node 18，把文件夹传上去
2. `ADMIN_TOKEN=xxx node server.js &`，或写 systemd / pm2 守护
3. Nginx 反代到 8080，配 SSL 证书（Let's Encrypt 免费）
4. **域名要备案**才能绑到国内服务器

好处：永不休眠、数据本地持久、访问快。

### 路线 C：其他免费云

Zeabur、Railway、Koyeb、Fly.io 都能跑这个 `server.js`，流程类似路线 A。

---

## 三、微信分享：能到什么程度

### 现在能做到的（发链接）

只要有了 https 链接，微信里发出去就能点开，**不需要任何公众号**。宾客看到的是：

> 一条链接卡片 + 自动抓取的网页标题和第一张图

为此页面里已经放好了 `og:title` / `og:description` / `og:image` 标签。你只要：

1. 做一张 **500×500（或 5:4）的图**，命名 `share.jpg` 放进目录 —— 建议就截 `stardew.html` 或 `classic.html` 的首屏
2. 上线后随便找个「分享预览」工具看一下抓取效果

### 想要「自定义封面 + 自定义标题」的漂亮卡片

这必须接 **微信 JS-SDK**，三个硬门槛：

1. **已认证的公众号**（服务号或认证订阅号）。个人主体的普通订阅号没有这个权限，这是死规定
2. **域名已备案**，并在公众号后台「设置与开发 → 公众号设置 → 功能设置」里填进 **JS 接口安全域名**
3. 公众号后台「设置与开发 → 基本配置」里加服务器 **IP 白名单**，否则拿不到 access_token

门槛满足后，签名接口我已经写好了（`server.js` 里的 `/api/wx-signature`）：

```bash
WX_APPID=你的AppID WX_SECRET=你的AppSecret ADMIN_TOKEN=xxx node server.js
```

然后在 `classic.html` / `stardew.html` 的 `</body>` 前贴这一段，就能自定义分享卡片：

```html
<script src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js"></script>
<script>
(function () {
  var shareUrl = location.href.split('#')[0];
  fetch('/api/wx-signature?url=' + encodeURIComponent(shareUrl))
    .then(function (r) { return r.json(); })
    .then(function (s) {
      if (!s || !s.ok) return;
      wx.config({
        debug: false,
        appId: s.appId,
        timestamp: s.timestamp,
        nonceStr: s.nonceStr,
        signature: s.signature,
        jsApiList: ['updateAppMessageShareData', 'updateTimelineShareData']
      });
      var data = {
        title: '我们要结婚啦 · 2026.12.20',
        desc: '杭州嘉宝丽酒店，期待与你相见',
        link: shareUrl,
        imgUrl: location.origin + '/share.jpg'
      };
      wx.ready(function () {
        wx.updateAppMessageShareData(data);
        wx.updateTimelineShareData(data);
      });
    })
    .catch(function () { /* 没配公众号就静默跳过 */ });
})();
</script>
```

> 没有公众号也不影响主功能：这段会静默失败，页面照常用。

### 一个常见坑

没备案的域名在微信里可能被提示「非微信官方网页，继续访问」，宾客点「继续」即可。想要彻底没有这个提示，就得备案。

---

## 四、改成你们的真实信息（重要）

两个页面都用同一套方式：打开 HTML，找到末尾 `★ 只需要改这里 ★` 下面的 `CONFIG`，改完保存，页面上所有位置一起变。

```js
const CONFIG = {
  bride: '新娘',                    // ← 新娘姓名
  groom: '新郎',                    // ← 新郎姓名
  dateNum: '2026.12.20',
  dateFull: '2026年12月20日',
  weekday: '星期日',
  weekday2: '星期日 · 晚',
  timeShort: '18:18 晚宴',
  timeBig: '18:18',                 // ← 开席时间
  timeTip: '晚宴开始 · 建议提前 15 分钟到场',
  venue: '杭州嘉宝丽酒店',
  address: '杭州市上城区杭海路601号',
  dateISO: '2026-12-20T18:18:00+08:00',   // ← 倒计时目标（+08:00 别删）
  rsvpMode: 'api',                  // 'api' 提交给后台；'clipboard' 只复制文字
  apiUrl: '/api/rsvp',              // 后台和页面同域时不用改
  photos: [],                       // ← 照片，见下
  mapQuery: '杭州嘉宝丽酒店'
};
```

1. **时间是占位**：你说的是「20 日晚上」，我先写成 18:18 晚宴开席 / 17:30 起迎宾。确认后改 `timeBig`、`timeTip`、`dateISO` 三处。
2. **姓名是占位**「新娘 / 新郎」，改 `bride` 和 `groom` 两行，首屏、邀请函落款、页脚全同步。
3. **放照片**：建一个 `assets` 文件夹，把照片放进去，然后：

   ```js
   photos: ['assets/1.jpg', 'assets/2.jpg', 'assets/3.jpg', 'assets/4.jpg']
   ```

   顺序对应 4 个节点（初遇 → 同行 → 约定 → 余年）。不填就一直显示「放入照片」的空框，不会裂图。建议宽 1200px、压缩过。
4. 故事文案、邀请函正文在 HTML 里直接改（搜「西湖边的一场雨」就能定位）。

---

## 五、宾客会不会提交失败？

不会。回执有三级兜底：

1. 正常 → `POST /api/rsvp` 存后台，页面显示「✓ 回执已送达」+ 已确认出席人数
2. 网络异常 / 后台没起来 → 自动复制文字，提示「⚠ 网络没通，回执已复制，请直接发给我们」
3. 浏览器太老 → 宾客可以手动选中文字复制，或直接在微信里告诉你

而且**每次提交都会把回执文本复制到剪贴板**（微信内置浏览器不支持新版剪贴板 API 时走旧的 `execCommand`），所以哪怕后台挂了也不会漏人。

---

## 六、兼容性与细节

- 常规版用系统自带中文字体，不下载字体，几 KB 秒开
- 像素版引用了 Google Fonts 的 `Press Start 2P`（只有拉丁字符，很小），国内加载不出来会自动退回系统字体，页面不会错乱。想让中文也变像素字，把「缝合像素字体 / Zpix」的 woff2 放进 `assets/fonts/`：

  ```css
  @font-face{
    font-family:'PixelCN';
    src:url('assets/fonts/pixel-cn.woff2') format('woff2');
    font-display:swap;
  }
  :root{ --px:'Press Start 2P','PixelCN','PingFang SC',sans-serif; }
  ```
- 手机端已适配（安全区、点按尺寸、单列）；支持系统「减弱动态效果」（会关掉动画）
- 像素版场景是 Canvas 手绘，25fps、离开视口自动暂停，不费电

---

## 七、还想加的东西

- 婚礼流程时间表（迎宾 / 仪式 / 晚宴）
- 温馨提示（着装、停车、儿童、能否带伴）
- 请帖页实时显示「已有 N 位亲友确认出席」
- 后台加「座位编排」「按联系人分组」
- 电子喜糖 / 祝福墙
- 宾客提交后自动推送微信模板消息（需要公众号 + 备案域名）
