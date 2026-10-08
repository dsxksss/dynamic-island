# 灵动岛下载托管

部署日期：2026-10-08。

## 当前版本 v1.4.0

- 下载地址：http://129.211.5.5/downloads/dynamic-island-1.4.0-windows-x64.exe
- 校验文件：http://129.211.5.5/downloads/dynamic-island-1.4.0-windows-x64.exe.sha256
- 文件大小：9,458,688 字节。
- SHA-256：`f863ab103a618b04df8e9adb4d91c7e07391a4c432634c4d4d2c3ae4da7f751b`
- 新增喝水记录、近 90 天贡献图与趋势图。
- 发布前配置备份：`/etc/nginx/conf.d/dynamic-island-downloads.conf.bak-20261008-1.4.0`。

## 保留版本 v1.3.4

- 下载地址：http://129.211.5.5/downloads/dynamic-island-1.3.4-windows-x64.exe
- 校验文件：http://129.211.5.5/downloads/dynamic-island-1.3.4-windows-x64.exe.sha256
- 文件大小：9,455,616 字节。
- SHA-256：`42971fcbcc3e336781e6fbff639fd24edca3f6b589d645b9e513b951e9f99e32`
- 服务器文件：`/srv/dynamic-island/downloads/dynamic-island-1.3.4-windows-x64.exe`
- 独立 Nginx 配置：`/etc/nginx/conf.d/dynamic-island-downloads.conf`
- 日志：`/var/log/nginx/dynamic-island-downloads.access.log` 与同目录的 `dynamic-island-downloads.error.log`。

使用服务器现有 Nginx，新增 80 端口下载站点。仅明确列出的版本文件和校验文件可访问，其余返回 404。已有 9857 端口站点未修改。Nginx 已启用开机启动。

验证：`nginx -t` 通过，服务 active/enabled；从公网完整下载 HTTP 200，字节数与 SHA-256 均匹配本地构建文件。

后续版本应保留已有版本文件，上传新文件、核对校验值后再增加对应下载路径，并在 `nginx -t` 成功后 reload。若移除此下载站点，仅撤销上述独立配置并校验、reload；不要停止其他站点共用的 Nginx 服务。

未在此文档保存服务器密码。
