// ==UserScript==
// @name         微博转Markdown
// @namespace    https://github.com/ytzhangFTD/weibo-to-markdown
// @version      1.2.3
// @description  将微博内容转换为Markdown格式并下载（含图片视频）
// @author       weibo-to-markdown
// @match        https://weibo.com/*
// @match        https://www.weibo.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      sinaimg.cn
// @connect      wx1.sinaimg.cn
// @connect      wx2.sinaimg.cn
// @connect      wx3.sinaimg.cn
// @connect      wx4.sinaimg.cn
// @connect      weibo.com
// @connect      f.video.weibocdn.com
// @connect      locallimit.us.sinaimg.cn
// @connect      us.sinaimg.cn
// ==/UserScript==

(function() {
    'use strict';

    // 开发模式：设为 true 开启调试日志
    const DEBUG = false;
    
    const log = (...args) => DEBUG && console.log('[微博转MD]', ...args);
    const logError = (...args) => console.error('[微博转MD]', ...args);

    const MARKED_CLASS = 'weibo-md-btn-added';

    // 获取XSRF-TOKEN
    function getXsrfToken() {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'XSRF-TOKEN') {
                return decodeURIComponent(value);
            }
        }
        return '';
    }

    // 通过API获取微博详情
    async function fetchWeiboDetail(weiboId) {
        const xsrfToken = getXsrfToken();
        const headers = {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken
        };
        
        const url = `https://weibo.com/ajax/statuses/show?id=${weiboId}&locale=zh-CN`;
        const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: headers
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // 处理长文本
        if (data.isLongText) {
            log('检测到长文本，获取完整内容...');
            const longTextUrl = `https://weibo.com/ajax/statuses/longtext?id=${weiboId}`;
            const longTextResponse = await fetch(longTextUrl, {
                method: 'GET',
                credentials: 'include',
                headers: headers
            });
            
            if (longTextResponse.ok) {
                const longTextData = await longTextResponse.json();
                if (longTextData.data && longTextData.data.longTextContent) {
                    data.text = longTextData.data.longTextContent;
                    log('已获取完整长文本');
                }
            }
        }
        
        // 处理转发微博的长文本
        if (data.retweeted_status && data.retweeted_status.isLongText) {
            log('原微博为长文本，获取完整内容...');
            const retweetId = data.retweeted_status.mblogid || data.retweeted_status.id;
            const longTextUrl = `https://weibo.com/ajax/statuses/longtext?id=${retweetId}`;
            
            try {
                const longTextResponse = await fetch(longTextUrl, {
                    method: 'GET',
                    credentials: 'include',
                    headers: headers
                });
                
                if (longTextResponse.ok) {
                    const longTextData = await longTextResponse.json();
                    if (longTextData.data && longTextData.data.longTextContent) {
                        data.retweeted_status.text = longTextData.data.longTextContent;
                        log('已获取原微博完整长文本');
                    }
                }
            } catch (e) {
                log('获取原微博长文本失败:', e);
            }
        }
        
        return data;
    }

    // 获取高清图片URL
    function getHighQualityPicUrl(url) {
        if (!url) return url;
        return url.replace(/\/(orj360|thumb150|mw690|mw1024)\//, '/large/');
    }

    // 清理HTML文本
    function cleanHtmlText(text) {
        if (!text) return '';
        text = text.replace(/<br\s*\/?>/gi, '\n');
        text = text.replace(/<\/?[^>]+(>|$)/g, '');
        text = text.replace(/&nbsp;/g, ' ');
        text = text.replace(/&amp;/g, '&');
        text = text.replace(/&lt;/g, '<');
        text = text.replace(/&gt;/g, '>');
        text = text.replace(/&quot;/g, '"');
        return text.trim();
    }

    // 格式化日期
    function formatDate(dateStr) {
        if (!dateStr) return '未知';
        try {
            let date;
            if (dateStr.includes('+0800') || dateStr.includes('+')) {
                date = new Date(dateStr);
            } else {
                date = new Date(dateStr);
            }
            
            if (isNaN(date.getTime())) {
                return dateStr;
            }
            
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hour = String(date.getHours()).padStart(2, '0');
            const minute = String(date.getMinutes()).padStart(2, '0');
            
            return `${year}-${month}-${day} ${hour}:${minute}`;
        } catch (e) {
            return dateStr;
        }
    }

    // 从URL获取文件扩展名
    function getExtension(url) {
        const match = url.match(/\.(\w+)(\?|$)/);
        return match ? match[1] : 'jpg';
    }

    // 收集微博中的所有资源（图片和视频）
    function collectResources(weiboData) {
        const resources = [];
        const isRetweet = !!weiboData.retweeted_status;

        // 收集转发微博的原微博资源
        if (isRetweet && weiboData.retweeted_status) {
            const retweet = weiboData.retweeted_status;
            
            // 原微博图片
            if (retweet.pic_ids && retweet.pic_infos) {
                let imgIndex = 1;
                for (const picId of retweet.pic_ids) {
                    const picInfo = retweet.pic_infos[picId];
                    if (picInfo) {
                        const picUrl = picInfo.largest?.url || picInfo.bmiddle?.url || picInfo.thumbnail?.url;
                        if (picUrl) {
                            const highQualityUrl = getHighQualityPicUrl(picUrl);
                            resources.push({
                                type: 'image',
                                url: highQualityUrl,
                                localName: `images/pic_${imgIndex}.${getExtension(highQualityUrl)}`,
                                index: imgIndex
                            });
                            imgIndex++;
                        }
                    }
                }
            }

            // 原微博视频
            if (retweet.page_info && retweet.page_info.type === 'video') {
                const pageInfo = retweet.page_info;
                const videoUrl = pageInfo.media_info?.stream_url_hd || pageInfo.media_info?.stream_url;
                
                if (videoUrl) {
                    resources.push({
                        type: 'video',
                        url: videoUrl,
                        localName: `videos/video.mp4`
                    });
                }
                
                // 视频封面
                if (pageInfo.page_pic?.url) {
                    const coverUrl = getHighQualityPicUrl(pageInfo.page_pic.url);
                    resources.push({
                        type: 'image',
                        url: coverUrl,
                        localName: `videos/cover.${getExtension(coverUrl)}`
                    });
                }
            }
        } else {
            // 非转发微博的图片
            if (weiboData.pic_ids && weiboData.pic_infos) {
                let imgIndex = 1;
                for (const picId of weiboData.pic_ids) {
                    const picInfo = weiboData.pic_infos[picId];
                    if (picInfo) {
                        const picUrl = picInfo.largest?.url || picInfo.bmiddle?.url || picInfo.thumbnail?.url;
                        if (picUrl) {
                            const highQualityUrl = getHighQualityPicUrl(picUrl);
                            resources.push({
                                type: 'image',
                                url: highQualityUrl,
                                localName: `images/pic_${imgIndex}.${getExtension(highQualityUrl)}`,
                                index: imgIndex
                            });
                            imgIndex++;
                        }
                    }
                }
            }

            // 非转发微博的视频
            if (weiboData.page_info && weiboData.page_info.type === 'video') {
                const pageInfo = weiboData.page_info;
                const videoUrl = pageInfo.media_info?.stream_url_hd || pageInfo.media_info?.stream_url;
                
                if (videoUrl) {
                    resources.push({
                        type: 'video',
                        url: videoUrl,
                        localName: `videos/video.mp4`
                    });
                }
                
                // 视频封面
                if (pageInfo.page_pic?.url) {
                    const coverUrl = getHighQualityPicUrl(pageInfo.page_pic.url);
                    resources.push({
                        type: 'image',
                        url: coverUrl,
                        localName: `videos/cover.${getExtension(coverUrl)}`
                    });
                }
            }
        }

        return resources;
    }

    // 使用GM_xmlhttpRequest下载资源（更可靠）
    function downloadResource(url, filename) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                headers: {
                    'Referer': 'https://weibo.com/'
                },
                onload: (response) => {
                    if (response.status === 200) {
                        const blob = response.response;
                        const blobUrl = URL.createObjectURL(blob);
                        
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(blobUrl);
                        
                        log(`下载成功: ${filename}`);
                        resolve(filename);
                    } else {
                        reject(new Error(`HTTP ${response.status}`));
                    }
                },
                onerror: (error) => {
                    logError(`下载失败: ${filename}`, error);
                    reject(error);
                }
            });
        });
    }

    // 转换为Markdown格式（支持本地路径替换）
    function convertToMarkdown(weiboData, resources = []) {
        if (!weiboData || weiboData.error) {
            return null;
        }

        // 创建URL到本地路径的映射
        const urlToPath = {};
        resources.forEach(r => {
            const hqUrl = getHighQualityPicUrl(r.url);
            urlToPath[hqUrl] = r.localName;
            urlToPath[r.url] = r.localName;
        });

        let md = '';
        const separator = '\n\n---\n\n';
        const isRetweet = !!weiboData.retweeted_status;
        const userName = weiboData.user?.screen_name || '未知用户';
        const createdAt = weiboData.created_at || '';
        
        if (isRetweet) {
            md += `# ${userName} 转发的微博\n\n`;
        } else {
            md += `# ${userName} 的微博\n\n`;
        }
        md += `> 发布时间: ${formatDate(createdAt)}\n\n`;

        const text = cleanHtmlText(weiboData.text);
        if (text && isRetweet) {
            md += `**转发评论:**\n\n${text}\n${separator}`;
        } else if (text) {
            md += `${text}\n${separator}`;
        }

        if (isRetweet && weiboData.retweeted_status) {
            const retweet = weiboData.retweeted_status;
            const retweetUser = retweet.user?.screen_name || '未知用户';
            const retweetUserId = retweet.user?.id || '';
            const retweetId = retweet.mblogid || retweet.id;
            
            md += `## 原微博内容\n\n`;
            md += `> **@${retweetUser}** 发布于 ${formatDate(retweet.created_at)}\n\n`;
            
            const retweetText = cleanHtmlText(retweet.text);
            if (retweetText) {
                md += `${retweetText}\n\n`;
            }

            // 原微博图片
            if (retweet.pic_ids && retweet.pic_infos) {
                md += `### 图片\n\n`;
                let imgIndex = 1;
                for (const picId of retweet.pic_ids) {
                    const picInfo = retweet.pic_infos[picId];
                    if (picInfo) {
                        const picUrl = picInfo.largest?.url || picInfo.bmiddle?.url || picInfo.thumbnail?.url;
                        if (picUrl) {
                            const hqUrl = getHighQualityPicUrl(picUrl);
                            const localPath = urlToPath[hqUrl] || hqUrl;
                            md += `![图片${imgIndex}](${localPath})\n\n`;
                            imgIndex++;
                        }
                    }
                }
            }

            // 原微博视频
            if (retweet.page_info && retweet.page_info.type === 'video') {
                md += `### 视频\n\n`;
                const pageInfo = retweet.page_info;
                const videoTitle = pageInfo.page_title || '微博视频';
                const videoUrl = pageInfo.media_info?.stream_url_hd || pageInfo.media_info?.stream_url || pageInfo.url;
                
                if (videoUrl) {
                    const localPath = urlToPath[videoUrl] || videoUrl;
                    md += `**${videoTitle}**\n\n`;
                    md += `视频文件: [${videoTitle}](${localPath})\n\n`;
                }
            }

            md += `\n### 原微博互动数据\n\n`;
            md += `- 点赞: ${retweet.attitudes_count || 0}\n`;
            md += `- 评论: ${retweet.comments_count || 0}\n`;
            md += `- 转发: ${retweet.reposts_count || 0}\n`;

            if (retweet.source) {
                md += `- 来源: ${cleanHtmlText(retweet.source)}\n`;
            }

            if (retweetId && retweetUserId) {
                md += `- 原微博链接: https://weibo.com/${retweetUserId}/${retweetId}\n`;
            }
            
            md += separator;
        } else {
            // 非转发微博的图片
            if (weiboData.pic_ids && weiboData.pic_infos) {
                md += `## 图片\n\n`;
                let imgIndex = 1;
                for (const picId of weiboData.pic_ids) {
                    const picInfo = weiboData.pic_infos[picId];
                    if (picInfo) {
                        const picUrl = picInfo.largest?.url || picInfo.bmiddle?.url || picInfo.thumbnail?.url;
                        if (picUrl) {
                            const hqUrl = getHighQualityPicUrl(picUrl);
                            const localPath = urlToPath[hqUrl] || hqUrl;
                            md += `![图片${imgIndex}](${localPath})\n\n`;
                            imgIndex++;
                        }
                    }
                }
                md += separator;
            }

            // 非转发微博的视频
            if (weiboData.page_info && weiboData.page_info.type === 'video') {
                md += `## 视频\n\n`;
                const pageInfo = weiboData.page_info;
                const videoTitle = pageInfo.page_title || '微博视频';
                const videoUrl = pageInfo.media_info?.stream_url_hd || pageInfo.media_info?.stream_url || pageInfo.url;
                
                if (videoUrl) {
                    const localPath = urlToPath[videoUrl] || videoUrl;
                    md += `**${videoTitle}**\n\n`;
                    md += `视频文件: [${videoTitle}](${localPath})\n\n`;
                }
                md += separator;
            }
        }

        md += `## 互动数据\n\n`;
        md += `- 点赞: ${weiboData.attitudes_count || 0}\n`;
        md += `- 评论: ${weiboData.comments_count || 0}\n`;
        md += `- 转发: ${weiboData.reposts_count || 0}\n`;
        md += separator;

        if (weiboData.source) {
            md += `> 来源: ${cleanHtmlText(weiboData.source)}\n\n`;
        }

        const weiboId = weiboData.mblogid || weiboData.id;
        const userId = weiboData.user?.id;
        if (weiboId && userId) {
            md += `> 微博链接: https://weibo.com/${userId}/${weiboId}\n`;
        }

        return md;
    }

    // 下载Markdown文件
    function downloadMarkdown(content, filename) {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // 从微博卡片中提取微博ID
    function getWeiboIdFromCard(article) {
        const timeSelectors = [
            'a._time_1tpft_33',
            'a[title][href*="weibo.com"]',
            'a[href*="/Q"]',
            'header a[href]'
        ];
        
        for (const selector of timeSelectors) {
            const timeLink = article.querySelector(selector);
            if (timeLink) {
                const href = timeLink.getAttribute('href') || '';
                
                let match = href.match(/weibo\.com\/\d+\/([A-Za-z0-9]+)/);
                if (match) return match[1];
                
                match = href.match(/^\/(\d+)\/([A-Za-z0-9]+)/);
                if (match) return match[2];
                
                match = href.match(/\/([A-Za-z][A-Za-z0-9]+)(?:\?|$|\/)/);
                if (match) return match[1];
            }
        }
        
        const midElement = article.querySelector('[mid]') || article.querySelector('[data-mid]');
        if (midElement) {
            const mid = midElement.getAttribute('mid') || midElement.getAttribute('data-mid');
            if (mid) return mid;
        }
        
        const allLinks = article.querySelectorAll('a[href]');
        for (const link of allLinks) {
            const href = link.getAttribute('href') || '';
            const match = href.match(/\/([A-Za-z][A-Za-z0-9]{7,})(?:\?|$|\/)/);
            if (match) return match[1];
        }
        
        return null;
    }

    // 从DOM中获取视频URL
    function getVideoUrlFromDom(article) {
        log('开始从DOM获取视频URL');
        
        // 方式1: 从video标签获取 (多种选择器)
        const videoSelectors = [
            'video[src]',
            'video.vjs-tech',
            'video',
            '.video-js video',
            'div[data-video] video'
        ];
        
        for (const selector of videoSelectors) {
            const videoElement = article.querySelector(selector);
            if (videoElement) {
                let src = videoElement.getAttribute('src') || videoElement.currentSrc;
                log(`选择器 ${selector} 找到视频元素, src:`, src);
                
                if (src && src.startsWith('//')) {
                    src = 'https:' + src;
                }
                if (src) {
                    log('从video标签获取视频URL:', src);
                    return src;
                }
            }
        }
        
        // 方式2: 从页面全局查找（当前聚焦的视频）
        const activeVideo = document.querySelector('video[src]:not([src=""])');
        if (activeVideo) {
            let src = activeVideo.getAttribute('src') || activeVideo.currentSrc;
            if (src && src.startsWith('//')) {
                src = 'https:' + src;
            }
            if (src && src.includes('sinaimg.cn')) {
                log('从全局video获取视频URL:', src);
                return src;
            }
        }
        
        // 方式3: 从source标签获取
        const sourceElement = article.querySelector('source[src]');
        if (sourceElement) {
            let src = sourceElement.getAttribute('src');
            if (src && src.startsWith('//')) {
                src = 'https:' + src;
            }
            if (src) {
                log('从source标签获取视频URL:', src);
                return src;
            }
        }
        
        log('未从DOM获取到视频URL');
        return null;
    }

    // 从DOM中获取视频封面URL
    function getVideoCoverFromDom(article) {
        const coverSelectors = [
            '.vjs-poster img',
            'video[poster]',
            '.video-js .vjs-poster img',
            'picture.vjs-poster img'
        ];
        
        for (const selector of coverSelectors) {
            const el = article.querySelector(selector);
            if (el) {
                const src = el.getAttribute('src') || el.getAttribute('poster');
                if (src) {
                    log('从DOM获取视频封面:', src);
                    return src;
                }
            }
        }
        return null;
    }

    // 创建导出按钮
    function createExportButton(weiboId, article) {
        const btn = document.createElement('div');
        btn.className = 'woo-box-item-flex weibo-md-export-btn';
        btn.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            margin-left: 8px;
            padding: 0 12px;
            height: 28px;
            border-radius: 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s ease;
            white-space: nowrap;
        `;
        btn.innerText = '导出';
        
        btn.onmouseenter = () => {
            btn.style.transform = 'scale(1.05)';
            btn.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.4)';
        };
        btn.onmouseleave = () => {
            btn.style.transform = 'scale(1)';
            btn.style.boxShadow = 'none';
        };
        
        btn.onclick = async (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            const originalText = btn.innerText;
            
            try {
                btn.innerText = '获取中...';
                btn.style.pointerEvents = 'none';

                if (!weiboId) {
                    alert('未找到微博ID');
                    return;
                }

                log('微博ID:', weiboId);

                const weiboData = await fetchWeiboDetail(weiboId);
                log('微博数据:', weiboData);

                if (!weiboData || weiboData.error) {
                    alert('获取微博内容失败: ' + (weiboData?.error || '未知错误'));
                    return;
                }

                // 生成基础文件名
                const userName = weiboData.user?.screen_name || 'weibo';
                const date = formatDate(weiboData.created_at).replace(/[/:]/g, '-').replace(/\s/g, '_');
                const baseName = `${userName}_${date}`;

                // 收集资源
                let resources = collectResources(weiboData);
                
                // 检查是否有视频资源
                const hasVideoResource = resources.some(r => r.type === 'video');
                
                // 如果没有从API获取到视频，尝试从DOM获取
                // 直接检查DOM中是否有视频元素
                if (!hasVideoResource && article) {
                    const domVideoUrl = getVideoUrlFromDom(article);
                    
                    if (domVideoUrl) {
                        log('从DOM获取到视频URL:', domVideoUrl);
                        resources.push({
                            type: 'video',
                            url: domVideoUrl,
                            localName: 'videos/video.mp4'
                        });
                    }
                    
                    const domCoverUrl = getVideoCoverFromDom(article);
                    if (domCoverUrl) {
                        resources.push({
                            type: 'image',
                            url: getHighQualityPicUrl(domCoverUrl),
                            localName: 'videos/cover.jpg'
                        });
                    }
                }
                
                log('收集到的资源:', resources);

                // 下载资源
                if (resources.length > 0) {
                    btn.innerText = `下载资源 0/${resources.length}`;
                    
                    let downloaded = 0;
                    for (const resource of resources) {
                        try {
                            const filename = `${baseName}/${resource.localName}`;
                            await downloadResource(resource.url, filename);
                            downloaded++;
                            btn.innerText = `下载资源 ${downloaded}/${resources.length}`;
                        } catch (err) {
                            logError('资源下载失败:', resource.url, err);
                        }
                    }
                }

                // 生成Markdown（带本地路径）
                const markdown = convertToMarkdown(weiboData, resources);
                if (!markdown) {
                    alert('转换Markdown失败');
                    return;
                }

                // 下载Markdown文件
                downloadMarkdown(markdown, `${baseName}/${baseName}.md`);
                
                btn.innerText = '✓';
                setTimeout(() => {
                    btn.innerText = originalText;
                }, 2000);

            } catch (error) {
                logError('导出失败:', error);
                alert('导出失败: ' + error.message);
                btn.innerText = originalText;
            } finally {
                btn.style.pointerEvents = 'auto';
            }
        };
        
        return btn;
    }

    // 为微博卡片添加导出按钮
    function addExportButtonToCard(article) {
        if (article.classList.contains(MARKED_CLASS)) {
            return;
        }
        article.classList.add(MARKED_CLASS);
        
        const weiboId = getWeiboIdFromCard(article);
        if (!weiboId) {
            log('未找到微博ID，跳过');
            return;
        }
        
        const footers = article.querySelectorAll('footer');
        if (footers.length === 0) return;
        
        const footer = footers[footers.length - 1];
        
        const actionBarSelectors = [
            '.woo-box-flex[class*="_left_"]',
            '.woo-box-flex[class*="_main_"]',
            '.woo-box-flex.woo-box-alignCenter',
            '.woo-box-flex'
        ];
        
        let actionBar = null;
        for (const selector of actionBarSelectors) {
            actionBar = footer.querySelector(selector);
            if (actionBar) break;
        }
        
        if (!actionBar) return;
        
        // 传递article元素用于获取视频URL
        const btn = createExportButton(weiboId, article);
        actionBar.appendChild(btn);
    }

    // 扫描并处理所有微博卡片
    function scanAndAddButtons() {
        const articles = document.querySelectorAll('article.woo-panel-main');
        articles.forEach(article => {
            addExportButtonToCard(article);
        });
    }

    // 初始化
    function init() {
        setTimeout(scanAndAddButtons, 1000);
        
        const observer = new MutationObserver((mutations) => {
            let shouldScan = false;
            mutations.forEach(mutation => {
                if (mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            if (node.tagName === 'ARTICLE' || 
                                node.querySelector?.('article.woo-panel-main') ||
                                node.classList?.contains('wbpro-scroller-item') ||
                                node.classList?.contains('vue-recycle-scroller__item-view')) {
                                shouldScan = true;
                            }
                        }
                    });
                }
            });
            
            if (shouldScan) {
                setTimeout(scanAndAddButtons, 100);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        let scrollTimeout = null;
        window.addEventListener('scroll', () => {
            if (scrollTimeout) clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(scanAndAddButtons, 500);
        }, { passive: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
