const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwQ1jyePOExK9YbdU3LykeAoy_FqLmZNl7WKVRTV1G6BJ1zzAeE_tUReM-rswzupdU/exec";
const ROOT_FOLDER_ID = "1xWDed1IBzGdCA4r5vbds1x6AF31hSIUT";
const WM_FOLDER_ID = "1P_YxqI3LzWB4GhM2H7Sk05KrISjIpVc7";
// ==============================================================
// PATCH 0: xử lý sau khi đăng nhập thành công và giải mã Email:
// ==============================================================
// ==============================================================
// PATCH 39 (FIXED): QUẢN LÝ ĐĂNG NHẬP VÀ TỰ ĐỘNG TIÊM EMAIL
// ==============================================================
let currentUserEmail = localStorage.getItem('vinhloc_user_email') || null;

// 1. Kiểm tra trạng thái đăng nhập khi vừa mở web
document.addEventListener("DOMContentLoaded", () => {
    const loginScreen = document.getElementById('vinhloc-login-screen');
    if (currentUserEmail) {
        if (loginScreen) loginScreen.style.display = 'none';
    } else {
        if (loginScreen) loginScreen.style.display = 'flex';
    }
});

// Phải khai báo originalFetch trước để dùng trong lúc gọi hỏi Server
const originalFetch = window.fetch;

// 2. Xử lý giải mã và HỎI SERVER sau khi Google Login thành công
window.handleCredentialResponse = async function(response) {
    const responsePayload = decodeJwtResponse(response.credential);
    const tempEmail = responsePayload.email;
    
    // Đừng mở cửa vội! Hiện thông báo đang đem thẻ tên đi hỏi bảo vệ
    showToast(`<i class="fas fa-spinner fa-spin mr-2"></i> Đang kiểm tra quyền của ${tempEmail}...`);
    
    try {
        // GỌI THẲNG LÊN CODE.GS ĐỂ HỎI XEM EMAIL NÀY CÓ ĐƯỢC VÀO KHÔNG
        const res = await originalFetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'getMeta', email: tempEmail }) // Mượn lệnh getMeta để check chốt chặn
        });
        
        const data = await res.json();
        
        if (data.needLogin) {
            // ĐÂY RỒI! BÁC BẢO VỆ SERVER TRẢ LỜI: "TỪ CHỐI"
            showToast(`<i class="fas fa-times-circle mr-2"></i> Truy cập bị từ chối: ${tempEmail} không có quyền!`, true);
            
            // Xóa bộ nhớ form chọn tài khoản của Google để bắt người ta chọn lại
            if (window.google && window.google.accounts) google.accounts.id.disableAutoSelect();
            
            // KẾT THÚC SỚM TẠI ĐÂY, KHÔNG CHO TẮT MÀN HÌNH ĐĂNG NHẬP
            return; 
        }
        
        // --- NẾU SERVER KHÔNG TRẢ VỀ NEEDLOGIN TỨC LÀ CHO QUA ---
        currentUserEmail = tempEmail;
        
        // Lưu email vào máy
        localStorage.setItem('vinhloc_user_email', currentUserEmail);
        
        // ĐƯỢC CHO PHÉP THÌ BÂY GIỜ MỚI ẨN MÀN HÌNH ĐĂNG NHẬP NÈ
        const loginScreen = document.getElementById('vinhloc-login-screen');
        if (loginScreen) loginScreen.style.display = 'none';
        
        showToast(`<i class="fas fa-check-circle mr-2 text-green-400"></i> Đã cấp quyền: ${currentUserEmail}`);
        
        // Khởi động lại hệ thống dữ liệu
        if (typeof initDatabase === 'function') initDatabase();
        
    } catch (error) {
        showToast("Lỗi kết nối máy chủ khi xác thực!", true);
    }
};

function decodeJwtResponse(token) {
    let base64Url = token.split('.')[1];
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    let jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

// 3. THE ULTIMATE INTERCEPTOR: Chặn mọi gói tin Fetch để nhét Email vào
// 3. THE ULTIMATE INTERCEPTOR: Chặn mọi gói tin Fetch để nhét Email vào
window.fetch = async function() {
    if (arguments[0] === SCRIPT_URL && arguments[1] && arguments[1].body) {
        try {
            let payload = JSON.parse(arguments[1].body);
            // Kẹp email vào gói dữ liệu gửi đi (nếu đã được phép vào)
            if (currentUserEmail) {
                payload.email = currentUserEmail; 
                arguments[1].body = JSON.stringify(payload);
            }
        } catch(e) {}
    }
    
    const response = await originalFetch.apply(this, arguments);
    const clonedRes = response.clone();
    
    try {
        const data = await clonedRes.json();
        if (data && data.needLogin) {
            // SỬA LỖI Ở ĐÂY: Chỉ báo Toast đỏ nếu người dùng đã từng vào được app
            // Tránh việc app vừa mở lên đang chờ đăng nhập đã báo lỗi loạn xạ
            if (currentUserEmail) {
                showToast("Tài khoản đã bị thu hồi quyền trên Google Drive!", true);
            }
            
            localStorage.removeItem('vinhloc_user_email');
            currentUserEmail = null;
            const loginScreen = document.getElementById('vinhloc-login-screen');
            if (loginScreen) loginScreen.style.display = 'flex';
        }
    } catch(e) {}
    
    return response;
};
// ==============================================================
// ==============================================================
// Kết thúc patch 0
// ==============================================================
// Bỏ đọc từ localStorage để luôn làm mới stack mỗi khi mở app
localStorage.removeItem('appFolderStack'); 
let folderStack = [{ id: ROOT_FOLDER_ID, name: "Triển khai", scrollTop: 0 }];
let currentFolderId = folderStack[0].id;

let currentDriveItems = [];
let subFolderCache = {};
let folderDataCache = {};

// ==========================================
// 1. CẤU HÌNH DATABASE NỘI MÁY (INDEXED-DB)
// ==========================================
localforage.config({
    name: 'VinhLocDrive',
    storeName: 'app_data'
});

let appMeta = {};

// Thay thế toàn bộ hàm initDatabase() cũ bằng đoạn này:
// TẢI DỮ LIỆU TỪ Ổ CỨNG VÀO RAM LÚC MỞ APP
async function initDatabase() {
    try {
        const storedMeta = await localforage.getItem('vinhloc_meta');
        appMeta = storedMeta || {};

        // Kéo danh sách file và folder đã lưu vĩnh viễn ra
        const storedFolderCache = await localforage.getItem('vinhloc_folder_cache');
        folderDataCache = storedFolderCache || {};
        
        const storedSubCache = await localforage.getItem('vinhloc_subfolder_cache');
        subFolderCache = storedSubCache || {};

        let metaCleaned = false;
        for (let id in appMeta) {
            if (appMeta[id].cover && appMeta[id].cover.length > 30000) {
                appMeta[id].cover = ''; metaCleaned = true;
            }
        }
        if (metaCleaned) await localforage.setItem('vinhloc_meta', appMeta);

        console.log("Đã tải xong DB Offline. Không cần gọi Drive lại nữa!");
        
        // Render ngay lập tức trang Triển khai
        const params = new URLSearchParams(window.location.search);
        if (!params.get('shareId')) {
            loadFolder(ROOT_FOLDER_ID, "Triển khai", false, false);
        }
    } catch (err) {
        console.error("Lỗi tải DB:", err);
    }
}
initDatabase();
// KHÔNG DÙNG setInterval 3 GIÂY Ở ĐÂY NỮA


// ==========================================
// 2. HỆ THỐNG BACKGROUND QUEUE ĐỒNG BỘ NGẦM
// ==========================================
let isQueueProcessing = false;

// Hàm hỗ trợ đổi ID ảo thành ID thật khi có phản hồi từ Server
function replaceTempId(tempId, realId) {
    if (appMeta[tempId]) {
        appMeta[realId] = appMeta[tempId];
        delete appMeta[tempId];
        localforage.setItem('vinhloc_meta', appMeta);
    }

    let itemIdx = currentDriveItems.findIndex(i => i.id === tempId);
    if (itemIdx > -1) {
        currentDriveItems[itemIdx].id = realId;
        delete currentDriveItems[itemIdx].isPending;
    }

    for (let fId in folderDataCache) {
        let idx = folderDataCache[fId].findIndex(i => i.id === tempId);
        if (idx > -1) {
            folderDataCache[fId][idx].id = realId;
            delete folderDataCache[fId][idx].isPending;
        }
    }

    for (let mId in subFolderCache) {
        let idx = subFolderCache[mId].findIndex(i => i.id === tempId);
        if (idx > -1) {
            subFolderCache[mId][idx].id = realId;
            delete subFolderCache[mId][idx].isPending;
        }
    }
    // Cập nhật lại UI để xóa biểu tượng loading
    if (currentDriveItems.some(i => i.id === realId)) {
        window.renderItems(currentDriveItems);
    }
}

async function addActionToQueue(actionName, payload) {
    let queue = await localforage.getItem('vinhloc_action_queue') || [];
    queue.push({
        taskId: Date.now(),
        action: actionName,
        payload: payload,
        timestamp: new Date().toISOString()
    });
    await localforage.setItem('vinhloc_action_queue', queue);
    processActionQueue();
}

async function processActionQueue() {
    if (isQueueProcessing) return;
    isQueueProcessing = true;

    try {
        let queue = await localforage.getItem('vinhloc_action_queue') || [];

        while (queue.length > 0) {
            let currentTask = queue[0];
            try {
                // Hiện thanh trạng thái "Đang lưu..." nếu cần
                syncQueueCount++; updateSyncIndicator();

                let response = await fetch(SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({ action: currentTask.action, ...currentTask.payload })
                });
                let data = await response.json();

                if (data.success || data.id || data.url) {
                    // Nếu là hành động tạo thư mục, đổi ID ảo thành thật
                    if (currentTask.action === 'createFolder' && data.tempId && data.id) {
                        replaceTempId(data.tempId, data.id);
                    }
                    queue.shift();
                    await localforage.setItem('vinhloc_action_queue', queue);
                } else {
                    console.error("Lỗi từ server GAS:", data.message);
                    break;
                }
            } catch (networkError) {
                console.warn("Mất mạng, dừng Queue...");
                break;
            } finally {
                syncQueueCount--; updateSyncIndicator();
            }
        }
    } catch (err) {
        console.error("Lỗi Queue:", err);
    } finally {
        isQueueProcessing = false;
    }
}
setInterval(processActionQueue, 10000); // Tự động thử lại mỗi 10s

let expandedMegas = JSON.parse(localStorage.getItem('expandedMegas')) || [];

function showToast(msg, isError = false) {
    let t = document.createElement('div');
    t.className = `toast-popup ${isError ? 'bg-red-600' : 'bg-gray-900'}`;
    t.innerHTML = msg;
    document.getElementById('toast-container').appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 400);
    }, 1500);
}

window.addEventListener('popstate', (e) => {
    if (folderStack.length > 1) {
        folderStack.pop();
        localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
        let parent = folderStack[folderStack.length - 1];
        loadFolder(parent.id, parent.name, false, true);
    }
});

let syncQueueCount = 0;
const syncIndicator = document.getElementById('sync-indicator');
const syncIcon = document.getElementById('sync-icon');
const syncText = document.getElementById('sync-text');

function updateSyncIndicator() {
    if (syncQueueCount > 0) {
        syncIcon.innerHTML = '<i class="fas fa-circle-notch fa-spin text-blue-600"></i>';
        syncText.textContent = 'Đang lưu...';
        syncText.className = 'text-blue-600';
        syncIndicator.classList.remove('opacity-0');
    } else {
        syncIcon.innerHTML = '<i class="fa-solid fa-check-circle text-green-500"></i>';
        syncText.textContent = 'Đã đồng bộ';
        syncText.className = 'text-green-600';
        setTimeout(() => {
            if (syncQueueCount === 0) syncIndicator.classList.add('opacity-0');
        }, 1500);
    }
}

async function bgApiCall(action, payload = {}) {
    syncQueueCount++; updateSyncIndicator();
    payload.action = action;
    if (!payload.folderId) payload.folderId = currentFolderId;
    // THÊM DÒNG NÀY VÀO ĐÂY:
    payload.email = currentUserEmail;
    return fetch(SCRIPT_URL, {
        method: 'POST', body: JSON.stringify(payload)
    }).then(res => res.json()).catch(err => ({ success: false })).finally(() => {
        syncQueueCount--; updateSyncIndicator();
    });
}

function smoothUpdateUI(newMeta) {
    for (let id in newMeta) {
        const meta = newMeta[id];
        let targetInCurrent = currentDriveItems.find(i => i.id === id);
        if (targetInCurrent && meta.name) targetInCurrent.name = meta.name;

        for (let megaId in subFolderCache) {
            let targetInSub = subFolderCache[megaId].find(i => i.id === id);
            if (targetInSub && meta.name) targetInSub.name = meta.name;
        }

        document.querySelectorAll(`.item-name-${id}`).forEach(el => {
            if (meta.name && el.textContent !== meta.name) {
                el.textContent = meta.name; el.title = meta.name;
            }
        });

        document.querySelectorAll(`.item-desc-${id}`).forEach(el => {
            const newDesc = meta.desc || 'Chưa có mô tả';
            if (el.textContent !== newDesc) el.textContent = newDesc;
            if (meta.desc) el.classList.remove('hidden'); else el.classList.add('hidden');
        });

        document.querySelectorAll(`.item-cover-img-${id}`).forEach(img => {
            const icon = document.querySelector(`.item-cover-icon-${id}`);
            if (meta.cover) {
                if (img.src !== meta.cover) img.src = meta.cover;
                img.classList.remove('hidden'); if (icon) icon.classList.add('hidden');
            } else {
                img.classList.add('hidden'); if (icon) icon.classList.remove('hidden');
            }
        });
    }
}

async function silentFetchMeta() {
    try {
        const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getMeta' }) }).then(r => r.json());
        if (res && res.success && res.meta) {
            const isChanged = JSON.stringify(appMeta) !== JSON.stringify(res.meta);
            if (isChanged) {
                appMeta = res.meta; localforage.setItem('vinhloc_meta', appMeta);
                smoothUpdateUI(appMeta);
                if (folderStack.length === 1) window.renderItems(currentDriveItems);
            }
        }
    } catch (e) { }
}

setInterval(() => {
    if (document.getElementById('infoModal').classList.contains('hidden') && syncQueueCount === 0) {
        silentFetchMeta();
        if (typeof window.silentFetchFolder === 'function') window.silentFetchFolder();
    }
}, 5000);

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && syncQueueCount === 0) {
        silentFetchMeta();
        if (typeof window.silentFetchFolder === 'function') window.silentFetchFolder();
    }
});

function getMeta(id) {
    return appMeta[id] || { type: 'Triển khai', desc: '', cover: '' };
}

let currentCategory = 'Triển khai';
const folderListEl = document.getElementById('folderList');
const fileListEl = document.getElementById('fileList');
const loading = document.getElementById('loading');
const currentFolderName = document.getElementById('currentFolderName');
const btnBack = document.getElementById('btnBack');
const btnMenu = document.getElementById('btnMenu');
const fabMain = document.getElementById('fabMain');
const fabMenu = document.getElementById('fabMenu');
const fabIcon = document.getElementById('fabIcon');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const btnOpenDesign = document.getElementById('btn-open-design');

function toggleSidebar() {
    sidebar.classList.toggle('open');
    sidebarOverlay.style.display = sidebar.classList.contains('open') ? 'block' : 'none';
}

function switchCategory(cat, navigate = true) {
    currentCategory = cat;
    document.getElementById('menu-trienkhai').classList.remove('active');
    document.getElementById('menu-ytuong').classList.remove('active');
    if (cat === 'Triển khai') document.getElementById('menu-trienkhai').classList.add('active');
    else document.getElementById('menu-ytuong').classList.add('active');

    toggleSidebar();

    if (navigate) {
        folderStack = [{ id: ROOT_FOLDER_ID, name: cat, scrollTop: 0 }];
        localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
        history.pushState({ id: ROOT_FOLDER_ID }, '', '');
        loadFolder(ROOT_FOLDER_ID, cat, false, false);
    }
}

fabMain.addEventListener('click', () => {
    fabMenu.classList.toggle('hidden'); fabMenu.classList.toggle('flex');
    fabIcon.classList.toggle('fa-plus'); fabIcon.classList.toggle('fa-times');
    fabIcon.style.transform = fabMenu.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(135deg)';
    fabIcon.style.transition = '0.3s';
});

btnBack.addEventListener('click', () => { if (folderStack.length > 1) history.back(); });

function updateBreadcrumbs() {
    if (folderStack.length === 1) {
        currentFolderName.innerHTML = currentCategory;
        btnBack.classList.add('hidden'); btnMenu.classList.remove('hidden'); btnOpenDesign.classList.add('hidden');
    } else {
        currentFolderName.innerHTML = folderStack.map((f, i) => {
            if (i === folderStack.length - 1) return `<span class="font-bold">${f.name}</span>`;
            return `<span class="font-normal opacity-70 cursor-pointer" onclick="loadFolder('${f.id}','${f.name}')">${f.name}</span>`;
        }).join(' <i class="fas fa-chevron-right text-[10px] mx-1 opacity-50"></i> ');
        btnBack.classList.remove('hidden'); btnMenu.classList.add('hidden'); btnOpenDesign.classList.remove('hidden');
    }
}

async function apiCall(action, payload = {}) {
    if (action !== 'getMeta') loading.classList.remove('hidden');
    payload.action = action;
    if (!payload.folderId) payload.folderId = currentFolderId;
    // THÊM DÒNG NÀY VÀO ĐÂY:
    payload.email = currentUserEmail;
    try {
        const response = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
        const data = await response.json();
        if (action !== 'getMeta') loading.classList.add('hidden');
        return data;
    } catch (error) {
        if (action !== 'getMeta') loading.classList.add('hidden');
        return { success: false };
    }
}

async function loadFolder(folderId, folderName, isNewNavigation = false, isPopState = false) {
    if (isNewNavigation && !isPopState) {
        if (folderStack.length > 0) folderStack[folderStack.length - 1].scrollTop = document.getElementById('contentArea').scrollTop;
    }
    currentFolderId = folderId;
    if (isNewNavigation && !isPopState) {
        const existingIdx = folderStack.findIndex(f => f.id === folderId);
        if (existingIdx !== -1) folderStack = folderStack.slice(0, existingIdx + 1);
        else folderStack.push({ id: folderId, name: folderName, scrollTop: 0 });
        localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
        history.pushState({ id: folderId }, '', '');
    }
    updateBreadcrumbs();
    if (document.getElementById('searchInput')) document.getElementById('searchInput').value = '';
    if (document.getElementById('clearSearchBtn')) document.getElementById('clearSearchBtn').classList.add('hidden');

    const restoreScroll = () => {
        const targetStackItem = folderStack[folderStack.length - 1];
        if (targetStackItem && targetStackItem.scrollTop) {
            setTimeout(() => { document.getElementById('contentArea').scrollTop = targetStackItem.scrollTop; }, 10);
        } else { document.getElementById('contentArea').scrollTop = 0; }
    };

    if (folderDataCache[folderId]) {
        currentDriveItems = folderDataCache[folderId];
        window.renderItems(currentDriveItems);
        restoreScroll();
        apiCall('list', { folderId: folderId }).then(res => {
            if (res && res.success && JSON.stringify(folderDataCache[folderId]) !== JSON.stringify(res.data)) {
                folderDataCache[folderId] = res.data;
                if (currentFolderId === folderId) {
                    currentDriveItems = res.data;
                    const currentScroll = document.getElementById('contentArea').scrollTop;
                    window.renderItems(currentDriveItems);
                    document.getElementById('contentArea').scrollTop = currentScroll;
                }
            }
        });
    } else {
        folderListEl.innerHTML = '<div class="text-center text-gray-500 mt-10 w-full"><div class="loader mx-auto mb-3 border-blue-400"></div>Đang tải dữ liệu...</div>';
        fileListEl.innerHTML = '';
        const res = await apiCall('list', { folderId: folderId });
        if (res && res.success) {
            currentDriveItems = res.data; folderDataCache[folderId] = res.data;
            window.renderItems(currentDriveItems); restoreScroll();
        } else { folderListEl.innerHTML = '<div class="text-center text-gray-500 mt-10 w-full italic">Lỗi kết nối hoặc thư mục trống.</div>'; }
    }
}
// ==========================================
// 3. TỐI ƯU CÁC HÀNH ĐỘNG GIAO DIỆN LẠC QUAN
// ==========================================
const selectValueDiv = document.getElementById('customSelectValue');
const selectOptionsDiv = document.getElementById('customSelectOptions');
const hiddenTypeInput = document.getElementById('infoType');

if (selectValueDiv) selectValueDiv.addEventListener('click', () => selectOptionsDiv.classList.toggle('open'));

document.querySelectorAll('.custom-select-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
        const val = e.target.dataset.val;
        selectValueDiv.querySelector('span').textContent = val;
        hiddenTypeInput.value = val;
        selectOptionsDiv.classList.remove('open');
    });
});

window.downloadItem = async function (id, type, name, e) {
    if (e) e.stopPropagation();
    document.querySelectorAll('.item-action-menu').forEach(m => m.classList.add('hidden'));

    if (type === 'folder') {
        showToast(`<i class="fas fa-spinner fa-spin mr-2"></i> Đang chuẩn bị nén thư mục "${name}"...`);
        const res = await apiCall('list', { folderId: id });
        if (res && res.success && res.data.length > 0) {
            const filesToZip = res.data.filter(i => i.type !== 'folder');
            if (filesToZip.length === 0) { showToast(`Thư mục trống, không có tệp để tải!`); return; }
            showToast(`<i class="fas fa-spinner fa-spin mr-2"></i> Đang tải ${filesToZip.length} tệp để nén...`);

            const zip = new JSZip(); let successCount = 0;
            for (let f of filesToZip) {
                try {
                    const b64Res = await apiCall('getFileBase64', { fileId: f.id });
                    if (b64Res.success && b64Res.data) { zip.file(f.name, b64Res.data, { base64: true }); successCount++; }
                } catch (err) { }
            }
            if (successCount > 0) {
                showToast(`<i class="fas fa-spinner fa-spin mr-2"></i> Đang tạo file Zip...`);
                zip.generateAsync({ type: "blob" }).then(function (content) {
                    const link = document.createElement('a'); link.href = URL.createObjectURL(content); link.download = `${name}.zip`;
                    document.body.appendChild(link); link.click(); document.body.removeChild(link);
                    showToast(`<i class="fas fa-check mr-2"></i> Đã tải xong thư mục ${name}`);
                });
            } else showToast(`Lỗi: Không thể lấy dữ liệu các tệp.`, true);
        } else showToast(`Thư mục trống hoặc bị lỗi.`, true);
    } else {
        showToast(`<i class="fas fa-download mr-2"></i> Đang nạp tệp ${name}...`);
        try {
            const b64Res = await apiCall('getFileBase64', { fileId: id });
            if (b64Res.success && b64Res.data && b64Res.mimeType) {
                const byteCharacters = atob(b64Res.data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
                const blob = new Blob([new Uint8Array(byteNumbers)], { type: b64Res.mimeType });

                const fileObj = new File([blob], name, { type: b64Res.mimeType });
                if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
                    try { await navigator.share({ files: [fileObj], title: name }); return; } catch (e) { }
                }
                const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name;
                document.body.appendChild(link); link.click(); document.body.removeChild(link);
            } else throw new Error("Không lấy được dữ liệu");
        } catch (e) {
            showToast(`Đang tải...`, true);
            const iframe = document.createElement('iframe'); iframe.style.display = 'none';
            iframe.src = `https://drive.google.com/uc?export=download&id=${id}`;
            document.body.appendChild(iframe); setTimeout(() => document.body.removeChild(iframe), 15000);
        }
    }
}

window.shareItem = async function (id, type, name, e) {
    e.stopPropagation(); document.querySelectorAll('.item-action-menu').forEach(menu => menu.classList.add('hidden'));
    let mimeTypeParam = '';
    if (type === 'file') {
        const fileObj = currentDriveItems.find(i => i.id === id);
        if (fileObj && fileObj.mimeType) mimeTypeParam = `&mimeType=${encodeURIComponent(fileObj.mimeType)}`;
    }
    const shareUrl = `${window.location.origin}${window.location.pathname}?shareId=${id}&shareType=${type}&shareName=${encodeURIComponent(name)}${mimeTypeParam}`;
    if (navigator.share) {
        try { await navigator.share({ title: `Chia sẻ: ${name}`, text: `Mở xem chi tiết "${name}" trong ứng dụng:`, url: shareUrl }); } catch (err) { }
    } else {
        navigator.clipboard.writeText(shareUrl).then(() => showToast(`<i class="fas fa-link mr-2"></i> Đã copy link vào khay nhớ tạm!`));
    }
};

let currentEditId = null; let currentEditLevel = null; let currentEditType = null;

function closeInfoModal() {
    document.getElementById('infoModal').classList.add('hidden');
    document.getElementById('infoModal').classList.remove('flex');
}

(function () {
    async function pickLocalFiles({ accept = 'image/*', multiple = true, callback }) {
        try {
            if (window.showOpenFilePicker) {
                const pickerTypes = [];
                if (accept.includes('image')) pickerTypes.push({ description: 'Images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'] } });
                if (accept.includes('video')) pickerTypes.push({ description: 'Videos', accept: { 'video/*': ['.mp4', '.mov', '.webm', '.mkv'] } });
                const handles = await window.showOpenFilePicker({ multiple, excludeAcceptAllOption: true, types: pickerTypes });
                const files = []; for (const handle of handles) files.push(await handle.getFile());
                callback({ target: { files } }); return;
            }
        } catch (err) { }
        const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple; input.style.display = 'none';
        document.body.appendChild(input); input.addEventListener('change', callback); input.click(); setTimeout(() => { input.remove(); }, 10000);
    }

    const infoCoverWrapper = document.getElementById('infoCoverWrapper');
    if (infoCoverWrapper) infoCoverWrapper.onclick = async function (e) { e.preventDefault(); e.stopPropagation(); await pickLocalFiles({ accept: 'image/*', multiple: false, callback: window.handleCoverUpload }); };

    const uploadImageLabel = document.querySelector('label:has(#uploadImage)');
    if (uploadImageLabel) uploadImageLabel.onclick = async function (e) { e.preventDefault(); e.stopPropagation(); await pickLocalFiles({ accept: 'image/*', multiple: true, callback: window.handleMultipleFileUpload }); };

    const uploadVideoLabel = document.querySelector('label:has(#uploadVideo)');
    if (uploadVideoLabel) uploadVideoLabel.onclick = async function (e) { e.preventDefault(); e.stopPropagation(); await pickLocalFiles({ accept: 'video/*', multiple: true, callback: window.handleMultipleFileUpload }); };
})();

// DÙNG ACTION QUEUE ĐỂ XÓA ẢNH/THƯ MỤC LẠC QUAN
window.handleDelete = function (id, type, e) {
    e.stopPropagation(); document.getElementById(`menu-${id}`).classList.add('hidden');
    document.getElementById('modalTitle').textContent = 'Xác nhận xóa';
    document.getElementById('modalDesc').textContent = 'Bạn có chắc chắn muốn xóa mục này? Hành động này không thể hoàn tác.';
    document.getElementById('modalDesc').classList.remove('hidden'); document.getElementById('modalInput').classList.add('hidden');

    const btn = document.getElementById('modalConfirmBtn');
    btn.textContent = 'Xóa'; btn.className = 'px-5 py-2 bg-red-600 text-white font-bold rounded-xl';

    btn.onclick = () => {
        // Cập nhật giao diện xóa ngay lập tức
        currentDriveItems = currentDriveItems.filter(i => i.id !== id);
        folderDataCache[currentFolderId] = currentDriveItems;
        for (let megaId in subFolderCache) subFolderCache[megaId] = subFolderCache[megaId].filter(i => i.id !== id);
        window.renderItems(currentDriveItems);
        closeModal(); showToast(`<i class="fas fa-trash mr-2"></i> Đã xóa`);

        // Bỏ vào hàng đợi gửi lên Server ngầm
        addActionToQueue('delete', { id: id, type: type });
    };
    document.getElementById('customModal').classList.remove('hidden'); document.getElementById('customModal').classList.add('flex');
};

function closeModal() {
    document.getElementById('customModal').classList.add('hidden'); document.getElementById('customModal').classList.remove('flex');
}

window.toggleAccordion = async function (id, forceOpen = false) {
    const body = document.getElementById(`acc-${id}`); const icon = document.getElementById(`icon-${id}`);
    const isHidden = body.classList.contains('hidden');
    if (isHidden || forceOpen) {
        body.classList.remove('hidden'); icon.style.transform = 'rotate(90deg)';
        if (!expandedMegas.includes(id)) { expandedMegas.push(id); localStorage.setItem('expandedMegas', JSON.stringify(expandedMegas)); }

        if (!subFolderCache[id]) {
            body.innerHTML = '<div class="text-center text-blue-400 py-3 text-sm"><div class="loader mx-auto border-blue-400 mb-1" style="width:16px;height:16px;"></div>Tải...</div>';
            const res = await apiCall('list', { folderId: id });
            if (res && res.success) {
                subFolderCache[id] = res.data.filter(i => i.type === 'folder');
                renderSubFolders(id, subFolderCache[id]);
            } else body.innerHTML = '<div class="text-center text-gray-400 py-3 text-sm">Lỗi tải dữ liệu</div>';
        } else renderSubFolders(id, subFolderCache[id]);
    } else {
        body.classList.add('hidden'); icon.style.transform = 'rotate(0deg)';
        expandedMegas = expandedMegas.filter(m => m !== id); localStorage.setItem('expandedMegas', JSON.stringify(expandedMegas));
    }
};

function renderSubFolders(megaId, subFolders) {
    const container = document.getElementById(`acc-${megaId}`);
    if (subFolders.length === 0) { container.innerHTML = '<div class="pl-14 py-3 text-sm text-gray-400 italic">Trống</div>'; return; }

    container.innerHTML = subFolders.map(item => {
        const meta = getMeta(item.id);
        const imgHtml = `
            <img src="${meta.cover || ''}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0 shadow-sm item-cover-img-${item.id} ${meta.cover ? '' : 'hidden'}">
            <div class="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 text-blue-500 text-xl item-cover-icon-${item.id} ${meta.cover ? 'hidden' : ''}"><i class="fas fa-folder"></i></div>
        `;
        return `
        <div class="subfolder-row group" onclick="loadFolder('${item.id}', '${item.name}', true)">
            ${imgHtml}
            <div class="flex-1 overflow-hidden">
                <h4 class="text-sm font-bold text-gray-800 truncate item-name-${item.id}">${item.name}</h4>
                <p class="text-[11px] text-gray-500 truncate mt-0.5 item-desc-${item.id} ${meta.desc ? '' : 'hidden'}">${meta.desc || 'Chưa có mô tả'}</p>
            </div>
            <div class="relative" onclick="event.stopPropagation()">
                <button onclick="window.toggleItemMenu('${item.id}', event)" class="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-blue-600 rounded-full transition"><i class="fas fa-ellipsis-v"></i></button>
                <div id="menu-${item.id}" class="hidden absolute right-0 mt-1 w-44 bg-white rounded-2xl shadow-xl border border-gray-100 z-500 py-1.5 text-sm item-action-menu overflow-hidden">
                    <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition flex items-center" onclick="window.uiPromptFolder('${item.id}', event)"><i class="fas fa-folder-plus mr-3 text-green-500 w-4"></i>Thêm mục</div>
                    <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition flex items-center" onclick="window.shareItem('${item.id}', '${item.type}', '${item.name}', event)"><i class="fas fa-share-nodes mr-3 text-green-500 w-4"></i>Chia sẻ</div>
                    <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition flex items-center" onclick="window.openInfo('${item.id}', '${item.name}', '${item.type}', 'sub', event)"><i class="fas fa-info-circle mr-3 text-blue-500 w-4"></i>Thông tin</div>
                    <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition flex items-center" onclick="window.downloadItem('${item.id}', '${item.type}', '${item.name}', event)"><i class="fas fa-download mr-3 text-blue-500 w-4"></i>Tải xuống</div>
                    <div class="px-5 py-3 hover:bg-red-50 cursor-pointer text-red-600 font-semibold transition border-t border-gray-50 flex items-center" onclick="window.handleDelete('${item.id}', '${item.type}', event)"><i class="fas fa-trash mr-3 w-4"></i>Xóa</div>
                </div>
            </div>
        </div>`;
    }).join('');
}

// DÙNG ACTION QUEUE TẠO THƯ MỤC VỚI FAKE ID LẠC QUAN
window.uiPromptFolder = function (targetParentId = null, e = null) {
    if (e) { e.stopPropagation(); document.querySelectorAll('.item-action-menu').forEach(menu => menu.classList.add('hidden')); }
    closeFab();

    document.getElementById('modalTitle').textContent = 'Thư mục mới';
    document.getElementById('modalDesc').classList.add('hidden');
    document.getElementById('modalInput').classList.remove('hidden');
    document.getElementById('modalInput').value = '';
    document.getElementById('modalInput').placeholder = "Nhập tên thư mục...";

    const btn = document.getElementById('modalConfirmBtn');
    btn.textContent = 'Tạo'; btn.className = 'px-5 py-2 bg-blue-600 text-white font-bold rounded-xl';

    btn.onclick = () => {
        const val = document.getElementById('modalInput').value.trim();
        if (val) {
            const parentIdToUse = (targetParentId && typeof targetParentId === 'string') ? targetParentId : currentFolderId;
            closeModal();

            // TẠO FAKE ID
            const tempId = 'temp_folder_' + Date.now();
            const newItem = { id: tempId, name: val, type: 'folder', isPending: true };

            // CẬP NHẬT UI NGAY TỨC KHẮC
            if (parentIdToUse === currentFolderId) {
                if (folderStack.length === 1) {
                    appMeta[tempId] = { type: currentCategory, desc: '', cover: '' };
                    localforage.setItem('vinhloc_meta', appMeta);
                }
                currentDriveItems.unshift(newItem);
                folderDataCache[currentFolderId] = currentDriveItems;
                window.renderItems(currentDriveItems);
            } else if (subFolderCache[parentIdToUse]) {
                subFolderCache[parentIdToUse].unshift(newItem);
                renderSubFolders(parentIdToUse, subFolderCache[parentIdToUse]);
            }

            showToast(`<i class="fas fa-check mr-2"></i> Đã tạo mục "${val}"`);

            // ĐẨY LỆNH VÀO QUEUE ĐỂ XỬ LÝ BACKGROUND
            addActionToQueue('createFolder', {
                name: val,
                folderId: parentIdToUse,
                tempId: tempId // Gửi kèm tempId cho GAS để trả về
            });
        }
    };
    document.getElementById('customModal').classList.remove('hidden'); document.getElementById('customModal').classList.add('flex');
    setTimeout(() => document.getElementById('modalInput').focus(), 100);
}

let curMediaIdForDownload = null; let curMediaNameForDownload = null;
function openMedia(id, mimeType, name, tempUrlFull = null) {
    closeFab(); document.getElementById('mediaTitle').textContent = name;
    curMediaIdForDownload = id; curMediaNameForDownload = name;
    document.getElementById('mediaViewer').classList.remove('hidden'); document.getElementById('mediaViewer').classList.add('flex');
    if (mimeType.includes('image')) {
        let srcToUse = tempUrlFull && !tempUrlFull.includes('undefined') ? tempUrlFull : `https://drive.google.com/thumbnail?id=${id}&sz=w2000`;
        document.getElementById('mediaContent').innerHTML = `<img src="${srcToUse}" class="max-w-full max-h-full object-contain">`;
    } else {
        document.getElementById('mediaContent').innerHTML = `<video controls class="max-w-full max-h-full rounded-lg" src="${tempUrlFull || ''}"><p class="text-white">Video cần tải về để xem.</p></video>`;
    }
}
document.getElementById('btnDownloadCurrentMedia').addEventListener('click', (e) => {
    if (curMediaIdForDownload) window.downloadItem(curMediaIdForDownload, 'file', curMediaNameForDownload, e);
});
function closeMedia() {
    document.getElementById('mediaViewer').classList.add('hidden'); document.getElementById('mediaViewer').classList.remove('flex');
    document.getElementById('mediaContent').innerHTML = ''; curMediaIdForDownload = null;
}
function closeFab() { fabMenu.classList.add('hidden'); fabMenu.classList.remove('flex'); fabIcon.style.transform = 'rotate(0deg)'; fabIcon.classList.add('fa-plus'); fabIcon.classList.remove('fa-times'); }
// ==========================================
// 4. CHỨC NĂNG EDIT DESIGN & WATERMARK
// ==========================================
const state = { images: [], savedWatermarks: [], activeEditTarget: 'text', colorMode: 'color', activeElementId: null, layerOrder: [] };
const createText = (val, id = generateId()) => ({ id, val, x: 50, y: 50, scale: 30, rotation: 0, color: '#ffffff', stroke: 'transparent', fontFamily: 'Roboto', fontWeight: 'normal', fontStyle: 'normal', textShadow: 'none', opacity: 100 });
const createWm = (src, id = generateId()) => ({ id, src, x: 50, y: 50, scale: 30, rotation: 0, opacity: 100 });
const grid = document.getElementById('image-grid');
const mainContainerOverlay = document.getElementById('main-container-overlay');
const overlayContainer = document.getElementById('watermark-overlay-container');

function generateId() { return Math.random().toString(36).substr(2, 9); }
function getTargetImages() { const selected = state.images.filter(img => img.selected); return selected.length > 0 ? selected : state.images; }
function cleanUpLayerOrder() { state.layerOrder = state.layerOrder.filter(layer => { return state.images.some(img => { if (layer.type === 'text') return img.texts.some(t => t.id === layer.id); return img.wms.some(w => w.id === layer.id); }); }); }

document.getElementById('btn-open-design').addEventListener('click', () => {
    const driveImages = currentDriveItems.filter(item => item.type !== 'folder' && item.mimeType && item.mimeType.includes('image'))
        .map(item => ({ url: item.tempUrl ? item.tempUrl : `https://drive.google.com/thumbnail?id=${item.id}&sz=w2000` }));
    if (driveImages.length === 0) { closeFab(); showToast("Không tìm thấy ảnh nào!", true); return; }
    state.images = []; state.layerOrder = []; state.activeElementId = null;
    driveImages.forEach(img => { state.images.push({ id: generateId(), src: img.url, ratio: 'auto', panX: 50, panY: 50, selected: false, customName: '', texts: [], wms: [], filterBrightness: 100, filterDarkness: 0, filterSharpness: 0, filterContrast: 100, filterSaturate: 100, filterRotate: 0 }); });
    renderImages(); overlayContainer.style.display = 'flex';
});

document.getElementById('btn-close-design').addEventListener('click', () => { overlayContainer.style.display = 'none'; });

async function processAllEditedImages() {
    showToast('Đang xử lý xuất ảnh...'); state.activeElementId = null; renderImages(); renderLayers();
    const outputImages = [];
    for (let i = 0; i < state.images.length; i++) {
        const imgData = state.images[i]; const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
        const baseImg = await loadImage(imgData.src);
        let sX = 0, sY = 0, sWidth = baseImg.width, sHeight = baseImg.height;
        if (imgData.ratio !== 'auto') {
            let targetRatio = imgData.ratio === '1/1' ? 1 : (imgData.ratio === '4/5' ? 4 / 5 : 1.91 / 1);
            const currentRatio = baseImg.width / baseImg.height;
            if (currentRatio > targetRatio) { sHeight = baseImg.height; sWidth = baseImg.height * targetRatio; sX = (imgData.panX / 100) * (baseImg.width - sWidth); }
            else { sWidth = baseImg.width; sHeight = baseImg.width / targetRatio; sY = (imgData.panY / 100) * (baseImg.height - sHeight); }
        }
        canvas.width = sWidth; canvas.height = sHeight;
        ctx.save();
        let calcBright = imgData.filterBrightness - imgData.filterDarkness;
        let calcCont = imgData.filterContrast + imgData.filterSharpness / 2;
        ctx.filter = `brightness(${calcBright}%) contrast(${calcCont}%) saturate(${imgData.filterSaturate}%)`;
        ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(imgData.filterRotate * Math.PI / 180);
        let scaleFit = 1 + Math.abs(imgData.filterRotate) / 90 * 0.4; ctx.scale(scaleFit, scaleFit);
        ctx.drawImage(baseImg, sX, sY, sWidth, sHeight, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
        ctx.restore();

        for (let layer of state.layerOrder) {
            if (layer.type === 'wm') {
                const wmItem = imgData.wms.find(w => w.id === layer.id);
                if (wmItem) {
                    const wmImg = await loadImage(wmItem.src); const drawWidth = (canvas.width * wmItem.scale) / 100; const drawHeight = (wmImg.height / wmImg.width) * drawWidth;
                    ctx.save(); ctx.translate((canvas.width * wmItem.x) / 100, (canvas.height * wmItem.y) / 100); ctx.rotate((wmItem.rotation || 0) * Math.PI / 180); ctx.globalAlpha = wmItem.opacity / 100;
                    ctx.drawImage(wmImg, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight); ctx.restore();
                }
            } else if (layer.type === 'text') {
                const tItem = imgData.texts.find(t => t.id === layer.id);
                if (tItem) {
                    const fontSize = (canvas.width * tItem.scale) / 500;
                    ctx.save(); ctx.translate((canvas.width * tItem.x) / 100, (canvas.height * tItem.y) / 100); ctx.rotate((tItem.rotation || 0) * Math.PI / 180);
                    ctx.font = `${tItem.fontStyle} ${tItem.fontWeight} ${fontSize}px '${tItem.fontFamily}'`; ctx.fillStyle = tItem.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    if (tItem.textShadow !== 'none') { ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 4; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2; }
                    ctx.globalAlpha = tItem.opacity / 100;
                    if (tItem.stroke !== 'transparent') { ctx.strokeStyle = tItem.stroke; ctx.lineWidth = fontSize / 10; ctx.lineJoin = "round"; ctx.strokeText(tItem.val, 0, 0); }
                    ctx.shadowColor = "transparent"; ctx.fillText(tItem.val, 0, 0); ctx.restore();
                }
            }
        }
        const base64Data = canvas.toDataURL('image/jpeg', 1.0).replace(/^data:image\/jpeg;base64,/, '');
        const randomName = 'IMG_' + Math.random().toString(36).substring(2, 8).toUpperCase();
        const rawName = imgData.customName ? imgData.customName.trim() : randomName;
        const cleanName = rawName.replace(/[\/\\?%*:|"<>]/g, '');
        outputImages.push({ fileName: `${cleanName}.jpg`, data: base64Data });
    }
    return outputImages;
}

document.getElementById('save-all-btn').addEventListener('click', () => {
    if (state.images.length === 0) return showToast('Không có ảnh để lưu.', true);
    document.getElementById('save-options-modal').classList.remove('hidden'); document.getElementById('save-options-modal').classList.add('flex');
});

document.getElementById('btn-save-local').addEventListener('click', async () => {
    document.getElementById('save-options-modal').classList.add('hidden');
    try {
        const editedImages = await processAllEditedImages(); const safeFolderName = "VinhLoc_Design";
        for (let i = 0; i < editedImages.length; i++) {
            const img = editedImages[i]; const link = document.createElement('a'); link.href = 'data:image/jpeg;base64,' + img.data; link.download = `${safeFolderName}_${img.fileName}`;
            document.body.appendChild(link); link.click(); document.body.removeChild(link); await new Promise(r => setTimeout(r, 400));
        }
        showToast(`<i class="fas fa-check-circle mr-2"></i> Đã tải lần lượt ${editedImages.length} ảnh về máy!`);
    } catch (error) { showToast('Lỗi tải ảnh: ' + error.message, true); }
});

document.getElementById('btn-save-drive').addEventListener('click', async () => {
    document.getElementById('save-options-modal').classList.add('hidden'); document.getElementById('save-options-modal').classList.remove('flex');
    try {
        const editedImages = await processAllEditedImages(); if (editedImages.length === 0) return;
        showToast('<i class="fas fa-spinner fa-spin mr-2"></i> Đang tải lên Drive...');
        let newFolderId = null; let existingFolder = currentDriveItems.find(i => i.name === "ĐÃ CHỈNH SỬA" && i.type === "folder");
        if (existingFolder) newFolderId = existingFolder.id;
        else {
            let createRes = await apiCall('createFolder', { name: "ĐÃ CHỈNH SỬA" });
            newFolderId = createRes.folderId || createRes.id;
            if (newFolderId) { currentDriveItems.unshift({ id: newFolderId, name: "ĐÃ CHỈNH SỬA", type: "folder" }); folderDataCache[currentFolderId] = currentDriveItems; window.renderItems(currentDriveItems); }
        }
        if (!newFolderId) throw new Error("Không thể truy cập thư mục lưu trữ.");
        let successCount = 0;
        for (let i = 0; i < editedImages.length; i++) {
            let img = editedImages[i]; let uploadRes = await window.apiCall('upload', { folderId: newFolderId, filename: img.fileName, mimeType: 'image/jpeg', data: img.data });
            if (uploadRes && uploadRes.success) successCount++;
        }
        showToast(`<i class="fas fa-check-circle mr-2"></i> Đã lưu thành công ${successCount}/${editedImages.length} ảnh!`);
    } catch (error) { showToast('Lỗi lưu Drive: ' + error.message, true); }
});

let scrollInterval = null;
function startScroll(dir) { if (scrollInterval) clearInterval(scrollInterval); scrollInterval = setInterval(() => { mainContainerOverlay.scrollTop += dir * 25; }, 16); }
function stopScroll() { if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null; } }
['touchstart', 'mousedown'].forEach(evt => { document.getElementById('scroll-up-btn').addEventListener(evt, (e) => { e.preventDefault(); startScroll(-1); }); document.getElementById('scroll-down-btn').addEventListener(evt, (e) => { e.preventDefault(); startScroll(1); }); });
['touchend', 'mouseup', 'mouseleave'].forEach(evt => { document.getElementById('scroll-up-btn').addEventListener(evt, stopScroll); document.getElementById('scroll-down-btn').addEventListener(evt, stopScroll); });

function renderLayers() {
    const menu = document.getElementById('layer-menu'); menu.innerHTML = '<div class="layer-title" style="padding:15px; font-weight:bold; border-bottom:1px solid #f3f4f6;">Z-Index</div>';
    if (state.layerOrder.length === 0) { menu.innerHTML += '<div style="padding:15px; font-size:13px; text-align:center;">Trống</div>'; return; }
    [...state.layerOrder].reverse().forEach((layer, revIdx) => {
        const realIndex = state.layerOrder.length - 1 - revIdx;
        const itemDiv = document.createElement('div'); itemDiv.className = `menu-item ${state.activeElementId === layer.id ? 'bg-gray-100' : ''}`; itemDiv.draggable = true; itemDiv.style.display = 'flex'; itemDiv.style.justifyContent = 'space-between';
        let cHTML = layer.type === 'text' ? `<i class="fa-solid fa-font mr-2 text-red-500"></i> <span>Chữ</span>` : `<i class="fa-solid fa-image mr-2 text-blue-500"></i> <span>Ảnh</span>`;
        itemDiv.innerHTML = `<div class="layer-info flex items-center flex-1" onclick="window.selectLayer('${layer.id}', '${layer.type}')">${cHTML}</div><div class="layer-controls flex gap-3 text-gray-400"><i class="fa-solid fa-chevron-up hover:text-blue-500" onclick="window.moveLayer(${realIndex}, 1, event)"></i><i class="fa-solid fa-chevron-down hover:text-blue-500" onclick="window.moveLayer(${realIndex}, -1, event)"></i><i class="fa-solid fa-trash hover:text-red-500" onclick="window.deleteLayer('${layer.id}', '${layer.type}', event)"></i></div>`;
        itemDiv.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', realIndex); });
        itemDiv.addEventListener('dragover', e => { e.preventDefault(); itemDiv.style.background = '#f5f5f5'; });
        itemDiv.addEventListener('dragleave', e => itemDiv.style.background = '');
        itemDiv.addEventListener('drop', e => { e.preventDefault(); const fromIdx = parseInt(e.dataTransfer.getData('text/plain')); if (fromIdx !== realIndex) { const [mv] = state.layerOrder.splice(fromIdx, 1); state.layerOrder.splice(realIndex, 0, mv); renderImages(); renderLayers(); } });
        menu.appendChild(itemDiv);
    });
}

window.selectLayer = function (id, type) { state.activeElementId = id; state.activeEditTarget = type; document.querySelector(`input[name="adjust-target"][value="${type}"]`).checked = true; renderImages(); renderLayers(); syncSliders(); const ap = document.querySelector('.nav-item[data-panel="panel-adjust"]'); if (!ap.classList.contains('active')) ap.click(); };
window.moveLayer = function (idx, dir, e) { e.stopPropagation(); const nIdx = idx + dir; if (nIdx < 0 || nIdx >= state.layerOrder.length) return; const t = state.layerOrder[idx]; state.layerOrder[idx] = state.layerOrder[nIdx]; state.layerOrder[nIdx] = t; renderImages(); renderLayers(); };
window.deleteLayer = function (id, type, e) { if (e) e.stopPropagation(); getTargetImages().forEach(img => { if (type === 'text') img.texts = img.texts.filter(t => t.id !== id); else img.wms = img.wms.filter(w => w.id !== id); }); cleanUpLayerOrder(); if (state.activeElementId === id) state.activeElementId = null; renderImages(); renderLayers(); };
document.getElementById('menu-btn').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('dropdown-menu').classList.toggle('show'); document.getElementById('layer-menu').classList.remove('show'); });
document.getElementById('layer-btn').addEventListener('click', (e) => { e.stopPropagation(); renderLayers(); document.getElementById('layer-menu').classList.toggle('show'); document.getElementById('dropdown-menu').classList.remove('show'); });
window.updateProp = function (key, val) { getTargetImages().forEach(img => { (state.activeEditTarget === 'text' ? img.texts : img.wms).forEach(item => { if (state.activeElementId) { if (item.id === state.activeElementId) item[key] = val; } else item[key] = val; }); }); renderImages(); };
window.applyRatio = function (r) { getTargetImages().forEach(img => img.ratio = r); renderImages(); };
window.toggleStyle = function (p, v1, v2) { let tg = getTargetImages(); if (tg.length === 0) return; let cur = v1; if (tg[0].texts.length > 0) { let t = tg[0].texts.find(x => x.id === state.activeElementId) || tg[0].texts[tg[0].texts.length - 1]; if (t) cur = t[p]; } window.updateProp(p, cur === v1 ? v2 : v1); };
window.updateFilter = function (prop, val) { getTargetImages().forEach(img => { img[prop] = parseFloat(val); }); renderImages(); };

function syncSliders() {
    const tg = getTargetImages();
    if (tg.length > 0) {
        const items = state.activeEditTarget === 'text' ? tg[0].texts : tg[0].wms;
        let ref = items.find(i => i.id === state.activeElementId) || items[items.length - 1];
        if (ref) { document.getElementById('slider-scale').value = ref.scale; document.getElementById('slider-x').value = ref.x; document.getElementById('slider-y').value = ref.y; document.getElementById('slider-opacity').value = ref.opacity; }
        const imgRef = tg[0];
        document.getElementById('slider-filter-brightness').value = imgRef.filterBrightness; document.getElementById('slider-filter-darkness').value = imgRef.filterDarkness; document.getElementById('slider-filter-sharpness').value = imgRef.filterSharpness; document.getElementById('slider-filter-contrast').value = imgRef.filterContrast; document.getElementById('slider-filter-saturate').value = imgRef.filterSaturate; document.getElementById('slider-filter-rotate').value = imgRef.filterRotate;
    }
}

document.querySelectorAll('input[name="adjust-target"]').forEach(r => r.addEventListener('change', e => { state.activeEditTarget = e.target.value; state.activeElementId = null; syncSliders(); renderLayers(); }));
document.querySelectorAll('#filter-sub-tabs .sub-tab-btn').forEach((btn, idx) => { btn.addEventListener('click', () => { document.querySelectorAll('#filter-sub-tabs .sub-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); document.querySelectorAll('#filter-sliders .slider-row').forEach((d, i) => { d.style.display = i === idx ? 'flex' : 'none'; }); }); });
['brightness', 'darkness', 'sharpness', 'contrast', 'saturate', 'rotate'].forEach(p => { const slider = document.getElementById(`slider-filter-${p}`); if (slider) { slider.addEventListener('input', e => { const stateProp = 'filter' + p.charAt(0).toUpperCase() + p.slice(1); window.updateFilter(stateProp, e.target.value); }); } });
document.querySelectorAll('#adjust-sub-tabs .sub-tab-btn').forEach((btn, idx) => { btn.addEventListener('click', () => { document.querySelectorAll('#adjust-sub-tabs .sub-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); document.querySelectorAll('#adjust-sliders .slider-row').forEach((d, i) => d.style.display = i === idx ? 'flex' : 'none'); }); });
['scale', 'x', 'y', 'opacity'].forEach(p => document.getElementById(`slider-${p}`).addEventListener('input', e => window.updateProp(p, e.target.value)));

const colorContainer = document.getElementById('color-picker-container'); colorContainer.innerHTML = '';
const pickerLabel = document.createElement('label'); pickerLabel.className = 'color-dot'; pickerLabel.style.background = 'linear-gradient(45deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff)'; pickerLabel.style.position = 'relative'; pickerLabel.style.display = 'block'; pickerLabel.innerHTML = '<input type="color" style="opacity:0; position:absolute; inset:0; width:100%; height:100%; cursor:pointer;" onchange="window.updateProp(state.colorMode, this.value)">'; colorContainer.appendChild(pickerLabel);
const colors40 = ['#ffffff', '#f8f9fa', '#e5e7eb', '#9ca3af', '#4b5563', '#000000', '#fecaca', '#ef4444', '#b91c1c', '#7f1d1d', '#fbcfe8', '#ec4899', '#be185d', '#831843', '#e9d5ff', '#d946ef', '#a21caf', '#701a75', '#bfdbfe', '#3b82f6', '#1d4ed8', '#1e3a8a', '#a7f3d0', '#10b981', '#047857', '#064e3b', '#fef08a', '#f59e0b', '#b45309', '#78350f', '#fed7aa', '#f97316', '#c2410c', '#7c2d12', '#e5e5e5', '#a3a3a3', '#525252', '#262626', '#fbbf24', '#d97706'];
colors40.forEach(c => { const d = document.createElement('div'); d.className = 'color-dot'; d.style.background = c; d.addEventListener('click', () => window.updateProp(state.colorMode, c)); colorContainer.appendChild(d); });

document.querySelectorAll('#text-sub-tabs .sub-tab-btn').forEach(btn => { btn.addEventListener('click', () => { document.querySelectorAll('#text-sub-tabs .sub-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); const tg = btn.dataset.target; document.getElementById('color-picker-wrapper').style.display = (tg === 'color' || tg === 'stroke') ? 'block' : 'none'; document.getElementById('font-picker-wrapper').style.display = tg === 'font' ? 'block' : 'none'; document.getElementById('style-picker-container').style.display = tg === 'style' ? 'flex' : 'none'; if (tg === 'color') state.colorMode = 'color'; if (tg === 'stroke') state.colorMode = 'stroke'; }); });
document.getElementById('btn-open-input').addEventListener('click', () => { if (state.activeElementId && state.activeEditTarget === 'text') { const t = getTargetImages()[0]?.texts.find(x => x.id === state.activeElementId); document.getElementById('main-text-input').value = t ? t.val : ''; } else document.getElementById('main-text-input').value = ''; document.getElementById('input-overlay').style.display = 'flex'; document.getElementById('main-text-input').focus(); });
document.getElementById('btn-close-input').addEventListener('click', () => document.getElementById('input-overlay').style.display = 'none');
document.getElementById('btn-apply-input').addEventListener('click', () => { const v = document.getElementById('main-text-input').value.trim(); if (!v) return; if (state.activeElementId && state.activeEditTarget === 'text') window.updateProp('val', v); else { const sI = generateId(); getTargetImages().forEach(i => i.texts.push(createText(v, sI))); state.layerOrder.push({ id: sI, type: 'text' }); state.activeElementId = sI; state.activeEditTarget = 'text'; document.querySelector(`input[name="adjust-target"][value="text"]`).checked = true; } renderImages(); renderLayers(); syncSliders(); document.getElementById('input-overlay').style.display = 'none'; });
document.getElementById('btn-delete-text').addEventListener('click', () => { getTargetImages().forEach(i => i.texts = []); cleanUpLayerOrder(); state.activeElementId = null; renderImages(); renderLayers(); });
document.getElementById('btn-delete-wm').addEventListener('click', () => { getTargetImages().forEach(i => i.wms = []); cleanUpLayerOrder(); state.activeElementId = null; renderImages(); renderLayers(); });

document.querySelectorAll('#rename-sub-tabs .sub-tab-btn').forEach(btn => { btn.addEventListener('click', () => { document.querySelectorAll('#rename-sub-tabs .sub-tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); const target = btn.dataset.target; if (target === 'rename-batch') { document.getElementById('rename-batch').style.display = 'flex'; document.getElementById('rename-individual').style.display = 'none'; } else { document.getElementById('rename-batch').style.display = 'none'; document.getElementById('rename-individual').style.display = 'flex'; window.renderRenameList(); } }); });
window.renderRenameList = function () { const cont = document.getElementById('rename-list-container'); cont.innerHTML = ''; const tg = getTargetImages(); if (tg.length === 0) { cont.innerHTML = '<div style="text-align:center;color:#777;margin-top:20px; font-style:italic;">Chưa chọn ảnh</div>'; return; } tg.forEach(img => { const d = document.createElement('div'); d.className = 'rename-item'; d.innerHTML = `<img src="${img.src}"><input type="text" value="${img.customName || ''}" placeholder="Nhập tên mới...">`; d.querySelector('input').addEventListener('input', e => img.customName = e.target.value); cont.appendChild(d); }); };
document.getElementById('btn-apply-batch-name').addEventListener('click', function () { const bn = document.getElementById('batch-name-input').value.trim(); if (!bn) return; getTargetImages().forEach((img, idx) => img.customName = `${bn}_${idx + 1}`); window.renderRenameList(); const originalHTML = this.innerHTML; this.innerHTML = '<i class="fa-solid fa-check"></i> Đã áp dụng'; this.classList.replace('btn-blue', 'bg-green-600'); setTimeout(() => { this.innerHTML = originalHTML; this.classList.replace('bg-green-600', 'btn-blue'); }, 1500); });

function renderImages() {
    grid.innerHTML = '';
    state.images.forEach(imgData => {
        const card = document.createElement('div'); card.className = `image-card ${imgData.selected ? 'selected' : ''}`; card.dataset.id = imgData.id; card.style.aspectRatio = imgData.ratio !== 'auto' ? imgData.ratio : 'auto';
        card.innerHTML = `<i class="fa-solid fa-circle-check check-icon"></i><i class="fa-solid fa-thumbtack pin-icon" onclick="event.stopPropagation(); const idx=state.images.findIndex(i=>i.id==='${imgData.id}'); if(idx>0){ const [it]=state.images.splice(idx,1); state.images.unshift(it); renderImages(); }"></i>`;
        const img = document.createElement('img'); img.className = 'base-img'; img.src = imgData.src;
        let calcBright = imgData.filterBrightness - imgData.filterDarkness; let calcCont = imgData.filterContrast + imgData.filterSharpness / 2;
        img.style.filter = `brightness(${calcBright}%) contrast(${calcCont}%) saturate(${imgData.filterSaturate}%)`;
        let scaleFit = 1 + Math.abs(imgData.filterRotate) / 90 * 0.4; img.style.transform = `rotate(${imgData.filterRotate}deg) scale(${scaleFit})`;
        if (imgData.ratio !== 'auto') {
            img.style.height = '100%'; img.style.objectFit = 'cover'; img.style.objectPosition = `${imgData.panX}% ${imgData.panY}%`;
            let isP = false, sX, sY, iX, iY;
            img.addEventListener('touchstart', e => { isP = false; sX = e.touches[0].clientX; sY = e.touches[0].clientY; iX = imgData.panX; iY = imgData.panY; }, { passive: true });
            img.addEventListener('touchmove', e => { const dx = e.touches[0].clientX - sX; const dy = e.touches[0].clientY - sY; if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isP = true; const pR = img.parentElement.getBoundingClientRect(); imgData.panX = Math.max(0, Math.min(100, iX - (dx / pR.width) * 100)); imgData.panY = Math.max(0, Math.min(100, iY - (dy / pR.height) * 100)); img.style.objectPosition = `${imgData.panX}% ${imgData.panY}%`; }, { passive: true });
            img.addEventListener('touchend', e => { if (isP) e.stopPropagation(); });
        }
        card.appendChild(img);

        state.layerOrder.forEach(layer => {
            if (layer.type === 'wm') {
                const wI = imgData.wms.find(w => w.id === layer.id); if (!wI) return;
                const wDiv = document.createElement('div'); wDiv.className = `overlay-item ${state.activeElementId === wI.id ? 'active' : ''}`;
                wDiv.style.left = `${wI.x}%`; wDiv.style.top = `${wI.y}%`; wDiv.style.width = `${wI.scale}%`; wDiv.style.opacity = wI.opacity / 100; wDiv.style.transform = `translate(-50%,-50%) rotate(${wI.rotation || 0}deg)`;
                wDiv.innerHTML = `<img class="overlay-img" src="${wI.src}"><div class="ctrl-btn ctrl-delete"><i class="fa-solid fa-times"></i></div><div class="ctrl-btn ctrl-scale-rotate"><i class="fa-solid fa-arrows-up-down-left-right"></i></div>`;
                setupTouchDrag(wDiv, imgData, wI, 'wm'); card.appendChild(wDiv);
            } else {
                const tI = imgData.texts.find(t => t.id === layer.id); if (!tI) return;
                const tDiv = document.createElement('div'); tDiv.className = `overlay-item text-layer ${state.activeElementId === tI.id ? 'active' : ''}`;
                tDiv.style.left = `${tI.x}%`; tDiv.style.top = `${tI.y}%`; tDiv.style.fontSize = `${tI.scale / 5}cqw`; tDiv.style.color = tI.color; tDiv.style.opacity = tI.opacity / 100; tDiv.style.transform = `translate(-50%,-50%) rotate(${tI.rotation || 0}deg)`;
                tDiv.style.fontFamily = tI.fontFamily; tDiv.style.fontWeight = tI.fontWeight; tDiv.style.fontStyle = tI.fontStyle; tDiv.style.textShadow = tI.textShadow; tDiv.style.webkitTextStroke = tI.stroke !== 'transparent' ? `4px ${tI.stroke}` : '0px transparent';
                tDiv.innerHTML = `<span>${tI.val}</span><div class="ctrl-btn ctrl-delete"><i class="fa-solid fa-times"></i></div><div class="ctrl-btn ctrl-scale-rotate"><i class="fa-solid fa-arrows-up-down-left-right"></i></div>`;
                setupTouchDrag(tDiv, imgData, tI, 'text'); card.appendChild(tDiv);
            }
        });
        card.addEventListener('click', e => { if (e.target.closest('.overlay-item') || e.target.closest('.pin-icon')) return; imgData.selected = !imgData.selected; state.activeElementId = null; renderImages(); renderLayers(); if (document.getElementById('panel-rename').classList.contains('active')) window.renderRenameList(); });
        grid.appendChild(card);
    });
}

function setupTouchDrag(el, iD, itD, ty) {
    let isD = false, isS = false, sX, sY, iX, iY, iSc, iR, cX, cY, sA;
    el.addEventListener('touchstart', e => {
        state.activeElementId = itD.id; state.activeEditTarget = ty; document.querySelector(`input[name="adjust-target"][value="${ty}"]`).checked = true;
        if (e.target.closest('.ctrl-delete')) { window.deleteLayer(itD.id, ty, e); return; }
        const t = e.touches[0];
        if (e.target.closest('.ctrl-scale-rotate')) {
            isS = true; const r = el.getBoundingClientRect(); cX = r.left + r.width / 2; cY = r.top + r.height / 2; iSc = itD.scale; iR = itD.rotation || 0; sX = t.clientX; sY = t.clientY; sA = Math.atan2(sY - cY, sX - cX);
        } else { isD = true; sX = t.clientX; sY = t.clientY; iX = itD.x; iY = itD.y; }
        document.querySelectorAll('.overlay-item').forEach(e => e.classList.remove('active')); el.classList.add('active'); syncSliders(); renderLayers();
    }, { passive: true });
    el.addEventListener('touchmove', e => {
        if (!isD && !isS) return; e.preventDefault(); const t = e.touches[0];
        if (isD) { const pR = el.parentElement.getBoundingClientRect(); itD.x = iX + ((t.clientX - sX) / pR.width) * 100; itD.y = iY + ((t.clientY - sY) / pR.height) * 100; el.style.left = `${itD.x}%`; el.style.top = `${itD.y}%`; document.getElementById('slider-x').value = itD.x; document.getElementById('slider-y').value = itD.y; }
        else if (isS) { const dist = Math.sqrt(Math.pow(t.clientX - cX, 2) + Math.pow(t.clientY - cY, 2)); itD.scale = iSc * (dist / (Math.sqrt(Math.pow(sX - cX, 2) + Math.pow(sY - cY, 2)) || 1)); itD.rotation = iR + ((Math.atan2(t.clientY - cY, t.clientX - cX) - sA) * (180 / Math.PI)); el.style.transform = `translate(-50%,-50%) rotate(${itD.rotation}deg)`; if (ty === 'text') el.style.fontSize = `${itD.scale / 5}cqw`; else el.style.width = `${itD.scale}%`; document.getElementById('slider-scale').value = itD.scale; }
    });
    el.addEventListener('touchend', () => { isD = false; isS = false; const tg = getTargetImages(); if (tg.length > 1 || (!iD.selected && tg.length === state.images.length)) { tg.forEach(i => { const match = (ty === 'text' ? i.texts : i.wms).find(x => x.id === state.activeElementId); if (match && match !== itD) { match.x = itD.x; match.y = itD.y; match.scale = itD.scale; match.rotation = itD.rotation; } }); renderImages(); } });
}

let aSel = false;
document.getElementById('select-all-btn').addEventListener('click', e => { aSel = !aSel; state.images.forEach(i => i.selected = aSel); e.target.innerHTML = aSel ? '<i class="fa-solid fa-check-double mr-2 text-blue-500"></i> Bỏ chọn' : '<i class="fa-solid fa-check-double mr-2 text-blue-500"></i> Chọn tất cả'; renderImages(); if (document.getElementById('panel-rename').classList.contains('active')) window.renderRenameList(); });
document.getElementById('delete-selected-btn').addEventListener('click', () => { state.images = state.images.filter(i => !i.selected); renderImages(); if (document.getElementById('panel-rename').classList.contains('active')) window.renderRenameList(); });
document.querySelectorAll('.nav-item').forEach(item => { item.addEventListener('click', () => { const tP = document.getElementById(item.dataset.panel); if (item.classList.contains('active')) { item.classList.remove('active'); tP.classList.remove('active'); } else { document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); document.querySelectorAll('.control-panel').forEach(p => p.classList.remove('active')); item.classList.add('active'); tP.classList.add('active'); if (item.dataset.panel === 'panel-rename') { if (document.getElementById('rename-individual').style.display === 'flex') { window.renderRenameList(); } } } }); });
document.getElementById('btn-save-text-wm').addEventListener('click', async () => {
    const tg = getTargetImages(); if (tg.length === 0 || tg[0].texts.length === 0) return showToast('Không có chữ.', true);
    let t = tg[0].texts.find(x => x.id === state.activeElementId) || tg[0].texts[tg[0].texts.length - 1];
    const c = document.createElement('canvas'); const cx = c.getContext('2d'); c.width = 800; c.height = 200;
    cx.font = `${t.fontStyle} ${t.fontWeight} 60px '${t.fontFamily}'`; cx.fillStyle = t.color; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    if (t.textShadow !== 'none') { cx.shadowColor = "rgba(0,0,0,0.8)"; cx.shadowBlur = 4; cx.shadowOffsetX = 2; cx.shadowOffsetY = 2; }
    if (t.stroke !== 'transparent') { cx.strokeStyle = t.stroke; cx.lineWidth = 6; cx.lineJoin = "round"; cx.strokeText(t.val, 400, 100); }
    cx.shadowColor = "transparent"; cx.fillText(t.val, 400, 100);
    const base64Data = c.toDataURL('image/png').split(',')[1];
    showToast('<i class="fas fa-spinner fa-spin mr-2"></i> Đang lưu chữ lên Drive...');
    let res = await bgApiCall('upload', { folderId: WM_FOLDER_ID, filename: 'TEXT_WM_' + Date.now() + '.png', mimeType: 'image/png', data: base64Data });
    if (res && res.success) { showToast('<i class="fas fa-check mr-2"></i> Đã lưu thành Watermark trên Drive'); const srcUrl = `https://drive.google.com/thumbnail?id=${res.id}&sz=w800`; state.savedWatermarks.unshift({ id: res.id, src: srcUrl }); if (wmP.style.display === 'flex') renderWMLibrary(); } else { showToast('Lỗi lưu Watermark', true); }
});

const wmP = document.getElementById('watermark-popup'); let isFetchingWM = false;
document.getElementById('btn-open-wm-library').addEventListener('click', async () => {
    wmP.style.display = 'flex';
    if (state.savedWatermarks.length === 0) document.getElementById('wm-library-grid').innerHTML = '<div style="grid-column: span 3; text-align: center; padding: 30px;"><div class="loader mx-auto border-blue-500 mb-2"></div><span class="text-sm text-gray-500">Đang tải Thư viện Logo từ Drive...</span></div>';
    else renderWMLibrary();
    if (isFetchingWM) return;
    isFetchingWM = true;
    try {
        let res = await apiCall('list', { folderId: WM_FOLDER_ID });
        if (res && res.success) {
            const files = res.data.filter(i => i.type === 'file'); const newWms = files.map(f => ({ id: f.id, src: `https://drive.google.com/thumbnail?id=${f.id}&sz=w800` }));
            state.savedWatermarks = newWms; if (wmP.style.display === 'flex') renderWMLibrary();
        } else if (state.savedWatermarks.length === 0) document.getElementById('wm-library-grid').innerHTML = '<div style="grid-column: span 3; text-align: center; color: #ef4444; font-size: 13px; padding: 20px 0;">Thư mục Logo rỗng hoặc lỗi.</div>';
    } catch (e) { console.log("Lỗi đồng bộ thư viện WM ngầm.", e); } finally { isFetchingWM = false; }
});
document.getElementById('btn-close-wm-popup').addEventListener('click', () => wmP.style.display = 'none');

function renderWMLibrary() {
    const grid = document.getElementById('wm-library-grid'); grid.innerHTML = '';
    if (state.savedWatermarks.length === 0) { grid.innerHTML = '<div style="grid-column: span 3; text-align: center; color: #6b7280; font-size: 13px; padding: 20px 0;">Chưa có logo nào.</div>'; return; }
    state.savedWatermarks.forEach((wm) => {
        const i = document.createElement('div'); i.className = 'wm-item'; i.innerHTML = `<img src="${wm.src}"><div class="wm-delete-btn"><i class="fa-solid fa-times"></i></div>`;
        i.querySelector('.wm-delete-btn').addEventListener('click', e => { e.stopPropagation(); bgApiCall('delete', { id: wm.id, type: 'file' }).then(res => { if (res && res.success) showToast('<i class="fas fa-trash mr-2"></i> Đã xóa Logo'); }); state.savedWatermarks = state.savedWatermarks.filter(w => w.id !== wm.id); renderWMLibrary(); });
        i.addEventListener('click', () => { const sI = generateId(); getTargetImages().forEach(im => im.wms.push(createWm(wm.src, sI))); state.layerOrder.push({ id: sI, type: 'wm' }); state.activeElementId = sI; state.activeEditTarget = 'wm'; document.querySelector(`input[name="adjust-target"][value="wm"]`).checked = true; renderImages(); renderLayers(); syncSliders(); wmP.style.display = 'none'; });
        grid.appendChild(i);
    });
}
(function () {
    const wmBtn = document.getElementById('btn-upload-wm-local');
    if (wmBtn) {
        wmBtn.onclick = async function (e) {
            e.preventDefault(); e.stopPropagation(); const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none'; document.body.appendChild(input);
            input.addEventListener('change', function (ev) {
                const f = ev.target.files[0]; if (!f) return; showToast('<i class="fas fa-spinner fa-spin mr-2"></i> Đang tải Logo lên Drive...');
                const r = new FileReader(); r.onload = async function (evt) {
                    const b64 = evt.target.result; const base64Data = b64.split(',')[1];
                    let res = await bgApiCall('upload', { folderId: WM_FOLDER_ID, filename: f.name || 'WM_Logo.png', mimeType: f.type || 'image/png', data: base64Data });
                    if (res && res.success) {
                        showToast('<i class="fas fa-check mr-2"></i> Đã tải Logo lên Thư viện'); const srcUrl = `https://drive.google.com/thumbnail?id=${res.id}&sz=w800`;
                        state.savedWatermarks.unshift({ id: res.id, src: srcUrl }); if (wmP.style.display === 'flex') renderWMLibrary();
                        const sI = generateId(); getTargetImages().forEach(i => { i.wms.push(createWm(srcUrl, sI)); });
                        state.layerOrder.push({ id: sI, type: 'wm' }); state.activeElementId = sI; state.activeEditTarget = 'wm'; document.querySelector(`input[name="adjust-target"][value="wm"]`).checked = true;
                        renderImages(); renderLayers(); syncSliders();
                    } else showToast('Lỗi tải lên logo!', true);
                }; r.readAsDataURL(f); setTimeout(() => input.remove(), 1000);
            }); input.click();
        };
    }
})();

function loadImage(src) {
    return new Promise(async (resolve, reject) => {
        if (src.startsWith('data:')) { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Lỗi dữ liệu ảnh nội bộ.')); img.src = src; return; }
        const urlsToTry = [src, "https://wsrv.nl/?url=" + encodeURIComponent(src), "https://corsproxy.io/?" + encodeURIComponent(src), "https://api.allorigins.win/raw?url=" + encodeURIComponent(src)];
        for (let url of urlsToTry) {
            try {
                const response = await fetch(url); if (!response.ok) continue; const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob);
                const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Lỗi chuyển đổi dữ liệu ảnh.')); img.src = objectUrl; return;
            } catch (error) { console.warn("Thử tải thất bại với URL:", url); }
        }
        reject(new Error('Lỗi tải ảnh. Vui lòng tải lại trang hoặc kiểm tra kết nối mạng.'));
    });
}

// ==========================================
// 5. CÁC ĐOẠN PATCH & OVERRIDES BỔ SUNG 
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const sId = params.get('shareId'); const sType = params.get('shareType'); const sName = params.get('shareName'); const sMime = params.get('mimeType');
    
    // Nếu có link chia sẻ thì mới xử lý, còn lại để initDatabase lo
    if (sId) {
        window.history.replaceState({}, document.title, window.location.pathname);
        if (sType === 'folder') { 
            folderStack = [ { id: ROOT_FOLDER_ID, name: "Triển khai", scrollTop: 0 }, { id: sId, name: sName || "Thư mục chia sẻ", scrollTop: 0 } ]; 
            currentFolderId = sId; localStorage.setItem('appFolderStack', JSON.stringify(folderStack)); 
            loadFolder(sId, sName || "Thư mục chia sẻ", false, false); 
        } 
        else if (sType === 'file') { 
            loadFolder(ROOT_FOLDER_ID, "Triển khai", false, false); 
            setTimeout(() => { openMedia(sId, sMime || '', sName || 'File chia sẻ'); }, 500); 
        }
    }
});

const stickyStyle = document.createElement('style');
stickyStyle.innerHTML = ` .mega-header { position: sticky !important; top: 0; z-index: 15; background: white; box-shadow: 0 2px 5px rgba(0,0,0,0.05); border-bottom: 1px solid #e5e7eb; } `;
document.head.appendChild(stickyStyle);

function removeAccents(str) { if (!str) return ''; return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

const oldInput = document.getElementById('searchInput');
const smartInput = oldInput.cloneNode(true);
oldInput.parentNode.replaceChild(smartInput, oldInput);

document.getElementById('clearSearchBtn').onclick = function () { smartInput.value = ''; this.classList.add('hidden'); sessionStorage.removeItem('lastSearchResults'); sessionStorage.removeItem('lastSearchKeyword'); window.renderItems(currentDriveItems); };

smartInput.addEventListener('input', (e) => {
    const rawKeyword = e.target.value.trim(); const keyword = removeAccents(rawKeyword);
    if (window.smartSearchTimeout) clearTimeout(window.smartSearchTimeout);
    if (!rawKeyword) { document.getElementById('clearSearchBtn').classList.add('hidden'); window.renderItems(currentDriveItems); return; }
    document.getElementById('clearSearchBtn').classList.remove('hidden');

    window.smartSearchTimeout = setTimeout(async () => {
        const folderListEl = document.getElementById('folderList'); const fileListEl = document.getElementById('fileList');
        folderListEl.innerHTML = '<div class="text-center mt-8"><div class="loader mx-auto border-blue-400 mb-2"></div><p class="text-sm text-gray-500 font-semibold">Đang tìm kiếm...</p></div>'; fileListEl.innerHTML = '';
        let localResults = new Map();
        const checkMatch = (item) => { const itemName = removeAccents(item.name || ''); const itemMeta = appMeta[item.id]; const metaName = itemMeta ? removeAccents(itemMeta.name || '') : ''; return itemName.includes(keyword) || metaName.includes(keyword); };

        if (currentDriveItems) currentDriveItems.forEach(item => { if (checkMatch(item)) localResults.set(item.id, item); });
        Object.values(folderDataCache).forEach(arr => arr.forEach(item => { if (checkMatch(item)) localResults.set(item.id, item); }));
        Object.values(subFolderCache).forEach(arr => arr.forEach(item => { if (checkMatch(item)) localResults.set(item.id, item); }));
        Object.keys(appMeta).forEach(id => { if (removeAccents(appMeta[id].name || '').includes(keyword)) { if (!localResults.has(id)) localResults.set(id, { id: id, name: appMeta[id].name, type: 'folder' }); } });

        let resultsArray = Array.from(localResults.values());
        if (resultsArray.length > 0) window.renderItems(resultsArray, true);

        try {
            const res = await apiCall('globalSearch', { keyword: rawKeyword });
            if (res && res.success && res.data) { res.data.forEach(item => { if (!localResults.has(item.id)) localResults.set(item.id, item); }); resultsArray = Array.from(localResults.values()); }
        } catch (err) { console.log("Lỗi tìm kiếm trên mây, tiếp tục hiển thị kết quả offline."); }

        if (resultsArray.length > 0) { sessionStorage.setItem('lastSearchResults', JSON.stringify(resultsArray)); sessionStorage.setItem('lastSearchKeyword', rawKeyword); window.renderItems(resultsArray, true); }
        else folderListEl.innerHTML = '<div class="text-center text-gray-400 mt-8 w-full italic">Không tìm thấy kết quả nào chứa "' + rawKeyword + '".</div>';
    }, 400);
});

window.openInfo = function (id, name, itemType, level, e) {
    if (e) e.stopPropagation();
    const menuObj = document.getElementById(`menu-${id}`); if (menuObj) menuObj.classList.add('hidden');
    currentEditId = id; currentEditLevel = level; currentEditType = itemType;
    const meta = getMeta(id);
    document.getElementById('infoName').value = name;
    let currentType = meta.type || currentCategory; document.getElementById('infoType').value = currentType; document.querySelector('#customSelectValue span').textContent = currentType;
    document.getElementById('infoDesc').value = meta.desc || '';
    document.getElementById('infoCoverInput').value = '';
    const previewImg = document.getElementById('infoCoverPreview'); const placeholder = document.getElementById('infoCoverPlaceholder');

    if (meta.cover) { previewImg.src = meta.cover; previewImg.classList.remove('hidden'); placeholder.classList.add('hidden'); }
    else { previewImg.src = ''; previewImg.classList.add('hidden'); placeholder.classList.remove('hidden'); }

    document.getElementById('info-field-type').classList.add('hidden'); document.getElementById('info-field-desc').classList.add('hidden'); document.getElementById('info-field-cover').classList.add('hidden');
    if (itemType === 'folder') {
        document.getElementById('info-field-desc').classList.remove('hidden'); document.getElementById('info-field-cover').classList.remove('hidden');
        if (level === 'mega') document.getElementById('info-field-type').classList.remove('hidden');
    }
    document.getElementById('infoModal').classList.remove('hidden'); document.getElementById('infoModal').classList.add('flex');
};

window.toggleItemMenu = function (id, e) {
    e.stopPropagation();
    document.querySelectorAll('.item-action-menu').forEach(menu => { if (menu.id !== `menu-${id}`) menu.classList.add('hidden'); });
    document.querySelectorAll('.mega-header').forEach(header => header.style.zIndex = '15'); document.querySelectorAll('.mega-row, .subfolder-row').forEach(row => row.style.zIndex = '');
    const menuObj = document.getElementById(`menu-${id}`); menuObj.classList.toggle('hidden');
    if (!menuObj.classList.contains('hidden')) {
        const parentHeader = menuObj.closest('.mega-header'); if (parentHeader) parentHeader.style.zIndex = '9999';
        const parentRow = menuObj.closest('.mega-row') || menuObj.closest('.subfolder-row'); if (parentRow) { parentRow.style.position = 'relative'; parentRow.style.zIndex = '9998'; }
        menuObj.style.zIndex = '10000';
    }
};

document.addEventListener('click', (e) => {
    document.querySelectorAll('.mega-header').forEach(header => header.style.zIndex = '15'); document.querySelectorAll('.mega-row, .subfolder-row').forEach(row => { row.style.zIndex = ''; row.style.position = ''; });
    document.querySelectorAll('.item-action-menu').forEach(menu => menu.classList.add('hidden'));
    if (!e.target.closest('.dropdown')) document.querySelectorAll('.dropdown-menu').forEach(menu => menu.classList.remove('show'));
    if (!e.target.closest('.custom-select-wrapper')) { const selectOptions = document.getElementById('customSelectOptions'); if (selectOptions) selectOptions.classList.remove('open'); }
});

window.multiSelectState = { selectedIds: new Set() };

document.addEventListener("DOMContentLoaded", () => {
    const loadingDiv = document.getElementById('loading');
    if (loadingDiv && !document.getElementById('headerDropdownContainer')) {
        const menuHtml = `
        <div class="relative shrink-0 ml-2" id="headerDropdownContainer">
            <button onclick="window.toggleHeaderMenu(event)" class="text-white p-1 text-xl active:bg-blue-700 rounded-full transition w-8 h-8 flex items-center justify-center"><i class="fas fa-ellipsis-v"></i></button>
            <div id="headerDropdown" class="hidden absolute right-0 mt-3 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 text-sm text-gray-700 z-[9999] overflow-hidden"></div>
        </div>`;
        loadingDiv.insertAdjacentHTML('afterend', menuHtml);
    }
    const header = document.querySelector('header'); if (header) { header.classList.remove('z-20'); header.classList.add('z-[99999]'); }
    const mediaViewer = document.getElementById('mediaViewer'); if (mediaViewer) { mediaViewer.classList.remove('z-[60]'); mediaViewer.classList.add('z-[999999]'); }

    // Giao diện list view cho mobile
    const viewStyle = document.createElement('style');
    viewStyle.innerHTML = `
        #fileList.list-view { display: flex !important; flex-direction: column; gap: 8px; }
        #fileList.list-view > div.p-2\\.5 { flex-direction: row; align-items: center; padding: 10px !important; height: auto !important; border-radius: 16px !important; }
        #fileList.list-view > div > .h-32 { width: 60px !important; height: 60px !important; margin-bottom: 0 !important; margin-right: 14px; border-radius: 10px !important; flex-shrink: 0; }
        #fileList.list-view > div .absolute.top-2.right-2 { top: 50% !important; transform: translateY(-50%); right: 12px !important; }
        #fileList.list-view > div .absolute.top-2.left-2 { top: 10px !important; left: 10px !important; z-index: 30; }
        #fileList.list-view > div .px-1.flex.flex-col { flex: 1; min-width: 0; justify-content: center; }
        #fileList.list-view > div .line-clamp-2 { -webkit-line-clamp: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px !important; }
        #fileList.list-view > div .text-\\[10px\\] { font-size: 11px !important; }
        #fileList { --col-scale: 1; transition: grid-template-columns 0.2s ease-out; }
        #fileList:not(.list-view) > div.p-2\\.5 { padding: calc(0.625rem * var(--col-scale)) !important; border-radius: calc(1rem * var(--col-scale)) !important; }
        #fileList:not(.list-view) > div > .h-32 { height: calc(8rem * var(--col-scale)) !important; border-radius: calc(0.75rem * var(--col-scale)) !important; margin-bottom: calc(0.75rem * var(--col-scale)) !important; }
        #fileList:not(.list-view) .text-\\[13px\\] { font-size: calc(13px * var(--col-scale)) !important; line-height: 1.2 !important; }
        #fileList:not(.list-view) .text-\\[10px\\] { font-size: calc(10px * var(--col-scale)) !important; margin-top: calc(0.25rem * var(--col-scale)) !important; }
        #fileList:not(.list-view) .w-8 { width: calc(2rem * var(--col-scale)) !important; } #fileList:not(.list-view) .h-8 { height: calc(2rem * var(--col-scale)) !important; }
        #fileList:not(.list-view) .w-6 { width: calc(1.5rem * var(--col-scale)) !important; } #fileList:not(.list-view) .h-6 { height: calc(1.5rem * var(--col-scale)) !important; }
        #fileList:not(.list-view) .text-xs { font-size: calc(0.75rem * var(--col-scale)) !important; } #fileList:not(.list-view) i.fa-ellipsis-v { font-size: calc(1rem * var(--col-scale)) !important; }
    `;
    document.head.appendChild(viewStyle);

    const searchContainer = document.querySelector('.sticky.top-0 > div.relative');
    if (searchContainer && !document.getElementById('viewToggleBtn')) {
        const parent = searchContainer.parentElement; parent.classList.add('flex', 'gap-2', 'items-center'); searchContainer.classList.add('flex-1');
        const toggleBtn = document.createElement('button'); toggleBtn.id = 'viewToggleBtn'; toggleBtn.className = 'w-11 h-11 shrink-0 bg-gray-100 hover:bg-gray-200 rounded-xl text-gray-600 flex items-center justify-center transition shadow-sm border border-gray-200 active:bg-gray-300';
        parent.appendChild(toggleBtn);
        let isListView = localStorage.getItem('vinhloc_list_view') === 'true';
        const applyViewMode = () => { const fileList = document.getElementById('fileList'); if (isListView) { fileList.classList.add('list-view'); toggleBtn.innerHTML = '<i class="fas fa-th-large text-lg"></i>'; } else { fileList.classList.remove('list-view'); toggleBtn.innerHTML = '<i class="fas fa-list text-lg"></i>'; } localStorage.setItem('vinhloc_list_view', isListView); };
        toggleBtn.addEventListener('click', () => { isListView = !isListView; applyViewMode(); }); applyViewMode();
    }
});

document.addEventListener('click', (e) => {
    const headerDropdown = document.getElementById('headerDropdown'); const headerContainer = document.getElementById('headerDropdownContainer');
    if (headerDropdown && !headerDropdown.classList.contains('hidden')) { if (headerContainer && !headerContainer.contains(e.target)) headerDropdown.classList.add('hidden'); }
});

window.toggleFileSelection = function (id, e) {
    e.stopPropagation();
    if (window.multiSelectState.selectedIds.has(id)) window.multiSelectState.selectedIds.delete(id); else window.multiSelectState.selectedIds.add(id);
    window.renderItems(currentDriveItems);
    const menu = document.getElementById('headerDropdown'); if (menu && !menu.classList.contains('hidden')) window.buildHeaderMenu();
};

window.toggleHeaderMenu = function (e) {
    e.stopPropagation(); const menu = document.getElementById('headerDropdown');
    if (menu.classList.contains('hidden')) { window.buildHeaderMenu(); menu.classList.remove('hidden'); } else menu.classList.add('hidden');
};

window.buildHeaderMenu = function () {
    let types = new Set(); let hasFolders = false;
    currentDriveItems.forEach(item => { if (item.type === 'folder') hasFolders = true; else { let ext = item.name.split('.').pop().toLowerCase(); if (ext !== item.name) types.add('.' + ext); else types.add('Khác'); } });
    let totalItems = currentDriveItems.length; let allSelected = totalItems > 0 && currentDriveItems.every(i => window.multiSelectState.selectedIds.has(i.id));
    let html = `<div class="px-5 py-2 font-bold text-[11px] text-gray-400 uppercase tracking-wider bg-gray-50 border-b border-gray-100">Chọn lọc</div><div class="px-5 py-3 hover:bg-blue-50 cursor-pointer flex items-center justify-between transition font-semibold" onclick="window.selectAllItems()"><span>Tất cả</span>${allSelected ? '<i class="fas fa-check text-blue-600 bg-blue-100 p-1 rounded-full text-[10px]"></i>' : ''}</div>`;
    if (hasFolders) { let folderItems = currentDriveItems.filter(i => i.type === 'folder'); let folderSelected = folderItems.length > 0 && folderItems.every(i => window.multiSelectState.selectedIds.has(i.id)); html += `<div class="px-5 py-3 hover:bg-blue-50 cursor-pointer flex items-center justify-between transition font-medium border-t border-gray-50" onclick="window.selectByType('folder')"><span>Thư mục</span>${folderSelected ? '<i class="fas fa-check text-blue-600 bg-blue-100 p-1 rounded-full text-[10px]"></i>' : ''}</div>`; }
    types.forEach(type => { let itemsOfType = currentDriveItems.filter(i => i.type !== 'folder' && (i.name.toLowerCase().endsWith(type) || (type === 'Khác' && !i.name.includes('.')))); let typeSelected = itemsOfType.length > 0 && itemsOfType.every(i => window.multiSelectState.selectedIds.has(i.id)); html += `<div class="px-5 py-3 hover:bg-blue-50 cursor-pointer flex items-center justify-between transition font-medium border-t border-gray-50" onclick="window.selectByType('${type}')"><span>Đuôi ${type}</span>${typeSelected ? '<i class="fas fa-check text-blue-600 bg-blue-100 p-1 rounded-full text-[10px]"></i>' : ''}</div>`; });
    let selCount = window.multiSelectState.selectedIds.size; html += `<div class="border-t border-gray-200 mt-1"></div><div class="px-5 py-3 hover:bg-red-50 cursor-pointer text-red-600 font-bold flex items-center justify-between transition" onclick="window.deleteSelectedItems()"><span><i class="fas fa-trash-alt mr-2"></i>Xóa đã chọn</span>${selCount > 0 ? `<span class="bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-xs">${selCount}</span>` : ''}</div>`;
    document.getElementById('headerDropdown').innerHTML = html;
};

window.selectAllItems = function () {
    let allSelected = currentDriveItems.length > 0 && currentDriveItems.every(i => window.multiSelectState.selectedIds.has(i.id));
    if (allSelected) window.multiSelectState.selectedIds.clear(); else currentDriveItems.forEach(i => window.multiSelectState.selectedIds.add(i.id));
    window.buildHeaderMenu(); window.renderItems(currentDriveItems);
};

window.selectByType = function (type) {
    let itemsOfType = currentDriveItems.filter(i => { if (type === 'folder') return i.type === 'folder'; if (type === 'Khác') return i.type !== 'folder' && !i.name.includes('.'); return i.type !== 'folder' && i.name.toLowerCase().endsWith(type); });
    let allSelected = itemsOfType.length > 0 && itemsOfType.every(i => window.multiSelectState.selectedIds.has(i.id));
    itemsOfType.forEach(i => { if (allSelected) window.multiSelectState.selectedIds.delete(i.id); else window.multiSelectState.selectedIds.add(i.id); });
    window.buildHeaderMenu(); window.renderItems(currentDriveItems);
};

window.deleteSelectedItems = function () {
    if (window.multiSelectState.selectedIds.size === 0) return showToast("Vui lòng chọn mục cần xóa!", true);
    document.getElementById('modalTitle').textContent = 'Xóa nhiều mục'; document.getElementById('modalDesc').textContent = `Xác nhận xóa ${window.multiSelectState.selectedIds.size} mục đã chọn? Hành động này không thể hoàn tác.`; document.getElementById('modalDesc').classList.remove('hidden'); document.getElementById('modalInput').classList.add('hidden');
    const btn = document.getElementById('modalConfirmBtn'); btn.textContent = 'Xóa tất cả'; btn.className = 'px-5 py-2 bg-red-600 text-white font-bold rounded-xl';
    btn.onclick = async () => {
        closeModal(); let idsToDelete = Array.from(window.multiSelectState.selectedIds); let itemsToDelete = currentDriveItems.filter(i => idsToDelete.includes(i.id));
        currentDriveItems = currentDriveItems.filter(i => !idsToDelete.includes(i.id)); folderDataCache[currentFolderId] = currentDriveItems; window.multiSelectState.selectedIds.clear(); window.renderItems(currentDriveItems);
        showToast(`<i class="fas fa-spinner fa-spin mr-2"></i> Đang xóa ${idsToDelete.length} mục...`);
        let successCount = 0;
        for (let item of itemsToDelete) { let res = await bgApiCall('delete', { id: item.id, type: item.type }); if (res && res.success) successCount++; }
        showToast(`<i class="fas fa-check mr-2"></i> Đã xóa thành công ${successCount} mục.`);
    };
    document.getElementById('customModal').classList.remove('hidden'); document.getElementById('customModal').classList.add('flex');
};

window.handleMultipleFileUpload = function (event) {
    closeFab(); const files = event.target.files; if (!files || files.length === 0) return;
    syncQueueCount++; updateSyncIndicator(); let uploadQueue = [];
    for (let i = 0; i < files.length; i++) {
        let file = files[i]; let fakeId = 'temp_file_' + Date.now() + i; let tempUrl = URL.createObjectURL(file);
        let newItem = { id: fakeId, name: file.name, mimeType: file.type, type: 'file', tempUrl: tempUrl };
        uploadQueue.push({ file: file, id: fakeId, itemRef: newItem }); currentDriveItems.unshift(newItem);
    }
    folderDataCache[currentFolderId] = currentDriveItems; window.renderItems(currentDriveItems);
    setTimeout(async () => {
        for (let obj of uploadQueue) {
            try {
                let base64Data = await new Promise((resolve, reject) => { let reader = new FileReader(); reader.onload = (e) => resolve(e.target.result.split(',')[1]); reader.onerror = (e) => reject(e); reader.readAsDataURL(obj.file); });
                let res = await apiCall('upload', { filename: obj.file.name, mimeType: obj.file.type, data: base64Data });
                if (res && res.success) { obj.itemRef.id = res.fileId || res.id; URL.revokeObjectURL(obj.itemRef.tempUrl); delete obj.itemRef.tempUrl; }
            } catch (err) { console.error("Lỗi up file:", err); showToast(`Lỗi tải lên: ${obj.file.name}`, true); currentDriveItems = currentDriveItems.filter(i => i.id !== obj.id); }
            folderDataCache[currentFolderId] = currentDriveItems; window.renderItems(currentDriveItems);
            await new Promise(r => setTimeout(r, 200));
        }
        syncQueueCount--; updateSyncIndicator();
    }, 500);
    event.target.value = '';
};

// DÙNG ACTION QUEUE ĐỂ LƯU METADATA NGẦM LẠC QUAN
window.pendingCoverBase64 = null; window.pendingCoverMimeType = null;
if (!window.originalOpenInfoForCover) window.originalOpenInfoForCover = window.openInfo;
window.openInfo = function (id, name, itemType, level, e) { window.pendingCoverBase64 = null; window.pendingCoverMimeType = null; window.originalOpenInfoForCover(id, name, itemType, level, e); };

window.handleCoverUpload = function (event) {
    const file = event.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = function (e) {
        document.getElementById('infoCoverPreview').src = e.target.result; document.getElementById('infoCoverPreview').classList.remove('hidden'); document.getElementById('infoCoverPlaceholder').classList.add('hidden');
        window.pendingCoverBase64 = e.target.result.split(',')[1]; window.pendingCoverMimeType = file.type || 'image/jpeg';
    }; reader.readAsDataURL(file);
};

(function () {
    const oldSaveBtn = document.getElementById('infoSaveBtn');
    if (oldSaveBtn) {
        const newSaveBtn = oldSaveBtn.cloneNode(true);
        oldSaveBtn.parentNode.replaceChild(newSaveBtn, oldSaveBtn);
        newSaveBtn.onclick = () => {
            if (!currentEditId) return closeInfoModal();
            const newName = document.getElementById('infoName').value.trim(); const newType = document.getElementById('infoType').value; const newDesc = document.getElementById('infoDesc').value.trim();
            let newCover = appMeta[currentEditId]?.cover || ''; let pendingB64 = window.pendingCoverBase64; let pendingMime = window.pendingCoverMimeType; let tempCoverUrl = document.getElementById('infoCoverPreview').src; let previewImg = document.getElementById('infoCoverPreview');

            if (pendingB64 && previewImg && previewImg.src && !previewImg.src.endsWith('default.jpg')) {
                try {
                    const canvas = document.createElement('canvas'); let width = previewImg.naturalWidth || previewImg.width; let height = previewImg.naturalHeight || previewImg.height; const MAX_SIZE = 800;
                    if (!width || !height) { width = 800; height = 800; }
                    if (width > height) { if (width > MAX_SIZE) { height = Math.round(height * (MAX_SIZE / width)); width = MAX_SIZE; } } else { if (height > MAX_SIZE) { width = Math.round(width * (MAX_SIZE / height)); height = MAX_SIZE; } }
                    canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(previewImg, 0, 0, width, height);
                    const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7); newCover = compressedDataUrl;
                    const base64DataOnly = compressedDataUrl.split(',')[1]; if (base64DataOnly) { pendingB64 = base64DataOnly; pendingMime = 'image/jpeg'; }
                } catch (e) { console.error("Lỗi nén ảnh trên điện thoại:", e); newCover = tempCoverUrl; }
            }

            // GHI DỮ LIỆU VÀ CẬP NHẬT UI TỨC THÌ
            appMeta[currentEditId] = { type: newType, desc: newDesc, cover: newCover, name: newName };
            localforage.setItem('vinhloc_meta', appMeta);
            let nameChanged = false; const allSubItems = Object.values(subFolderCache).reduce((acc, arr) => acc.concat(arr), []); const oldItem = currentDriveItems.find(i => i.id === currentEditId) || allSubItems.find(i => i.id === currentEditId);
            if (newName && oldItem && newName !== oldItem.name) { nameChanged = true; folderDataCache[currentFolderId] = currentDriveItems; }
            smoothUpdateUI(appMeta); closeInfoModal();

            if (pendingB64) showToast(`<i class="fas fa-cloud-upload-alt mr-2 text-blue-400"></i> Đang tải ảnh bìa ngầm...`);
            else showToast(`<i class="fas fa-check mr-2 text-green-400"></i> Đã lưu cài đặt thư mục`);

            // ĐẨY LÊN HÀNG ĐỢI XỬ LÝ BACKGROUND THAY VÌ ĐỢI API
            if (pendingB64) {
                window.pendingCoverBase64 = null; window.pendingCoverMimeType = null;
                // Ảnh bìa ưu tiên gửi trước để lấy link xịn
                fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'upload', folderId: currentEditId, filename: '_cover.jpg', mimeType: pendingMime, data: pendingB64 }) }).then(r => r.json()).then(res => {
                    if (res && res.success) {
                        let permanentCover = `https://drive.google.com/thumbnail?id=${res.fileId || res.id}&sz=w800`;
                        appMeta[currentEditId].cover = permanentCover; localforage.setItem('vinhloc_meta', appMeta); smoothUpdateUI(appMeta);
                        addActionToQueue('updateSingleMeta', { meta: { id: currentEditId, name: newName, type: newType, desc: newDesc, cover: permanentCover } });
                    } else showToast('Lỗi tải ảnh bìa lên Drive!', true);
                });
            } else {
                addActionToQueue('updateSingleMeta', { meta: { id: currentEditId, name: newName, type: newType, desc: newDesc, cover: newCover } });
            }

            if (nameChanged) addActionToQueue('rename', { id: currentEditId, newName: newName, type: currentEditType });
        };
    }
})();

// Ghi đè hàm vẽ Item (Có hiển thị chọn lựa)
window.renderItems = function (items, isSearchMode = false) {
    let metaChanged = false;
    items.forEach(item => {
        if (item.type === 'folder') {
            if (!appMeta[item.id]) { appMeta[item.id] = { type: 'Triển khai', desc: '', cover: '' }; metaChanged = true; }
            let descStr = item.description || "";
            if (descStr) {
                let parsedType = null;
                if (descStr.includes('[Ý tưởng]') || descStr === 'Ý tưởng') parsedType = 'Ý tưởng';
                else if (descStr.includes('[Triển khai]') || descStr === 'Triển khai') parsedType = 'Triển khai';
                if (parsedType && appMeta[item.id].type !== parsedType) { appMeta[item.id].type = parsedType; metaChanged = true; }
                let coverMatch = descStr.match(/\[Cover:(.*?)\]/);
                if (coverMatch) {
                    let extractedCover = coverMatch[1] === 'NONE' ? '' : coverMatch[1].trim();
                    if (appMeta[item.id].cover !== extractedCover) { appMeta[item.id].cover = extractedCover; metaChanged = true; }
                }
                let rawDesc = descStr.replace(/\[(Ý tưởng|Triển khai)\]/g, '').replace(/\[Cover:.*?\]/g, '').trim();
                if (appMeta[item.id].desc !== rawDesc) { appMeta[item.id].desc = rawDesc; metaChanged = true; }
            }
        }
    });

    if (metaChanged) localforage.setItem('vinhloc_meta', appMeta);

    const folderListEl = document.getElementById('folderList'); const fileListEl = document.getElementById('fileList');
    folderListEl.innerHTML = ''; fileListEl.innerHTML = '';

    if (items.length === 0) { folderListEl.innerHTML = '<div class="text-center text-gray-400 mt-8 w-full italic">Không có dữ liệu.</div>'; return; }

    if (folderStack.length === 1 && !isSearchMode) {
        const megaRows = items.filter(i => i.type === 'folder' && getMeta(i.id).type === currentCategory);
        if (megaRows.length === 0) { folderListEl.innerHTML = `<div class="text-center text-gray-400 mt-8 w-full italic">Chưa có dữ liệu trong mục ${currentCategory}</div>`; return; }

        folderListEl.innerHTML = megaRows.map(item => {
            const meta = getMeta(item.id);
            return `
            <div class="mega-row">
                <div class="mega-header" onclick="window.toggleAccordion('${item.id}')">
                    <div class="flex items-center gap-3 overflow-hidden">
                        <i id="icon-${item.id}" class="fas fa-chevron-right text-gray-400 text-sm transition-transform duration-200 w-4 text-center"></i>
                        <div class="flex flex-col overflow-hidden">
                            <span class="truncate uppercase text-blue-800 item-name-${item.id}">${item.name}</span>
                            <span class="text-[11px] font-normal text-gray-500 truncate mt-1 item-desc-${item.id} ${meta.desc ? '' : 'hidden'}">${meta.desc || ''}</span>
                        </div>
                    </div>
                    <div class="relative flex-shrink-0" onclick="event.stopPropagation()">
                        <button onclick="window.toggleItemMenu('${item.id}', event)" class="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-blue-600 bg-gray-50 rounded-full transition"><i class="fas fa-ellipsis-v"></i></button>
                        <div id="menu-${item.id}" class="hidden absolute right-0 mt-2 w-44 bg-white rounded-2xl shadow-xl border border-gray-100 z-500 py-1.5 text-sm item-action-menu overflow-hidden">
                            <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition flex items-center" onclick="window.openInfo('${item.id}', '${item.name}', '${item.type}', 'mega', event)"><i class="fas fa-info-circle mr-3 text-blue-500 w-4"></i>Thông tin</div>
                            <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-green-600 font-semibold transition border-t border-gray-50 flex items-center" onclick="window.uiPromptFolder('${item.id}', event)"><i class="fas fa-folder-plus mr-3 w-4"></i>Thư mục</div>
                            <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition flex items-center" onclick="window.shareItem('${item.id}', '${item.type}', '${item.name}', event)"><i class="fas fa-share-nodes mr-3 text-green-500 w-4"></i>Chia sẻ</div>
                            <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition border-t border-gray-50 flex items-center" onclick="window.downloadItem('${item.id}', '${item.type}', '${item.name}', event)"><i class="fas fa-download mr-3 text-blue-500 w-4"></i>Tải xuống</div>
                            <div class="px-5 py-3 hover:bg-red-50 cursor-pointer text-red-600 font-semibold transition border-t border-gray-50 flex items-center" onclick="window.handleDelete('${item.id}', '${item.type}', event)"><i class="fas fa-trash mr-3 w-4"></i>Xóa</div>
                        </div>
                    </div>
                </div>
                <div id="acc-${item.id}" class="hidden bg-white border-t border-gray-100"></div>
            </div>`;
        }).join('');
        megaRows.forEach(row => { if (expandedMegas.includes(row.id)) window.toggleAccordion(row.id, true); });
    }
    else {
        const folders = items.filter(i => i.type === 'folder'); const files = items.filter(i => i.type !== 'folder');
        if (folders.length > 0) {
            folderListEl.innerHTML = folders.map(item => {
                const meta = getMeta(item.id); let isSelected = window.multiSelectState && window.multiSelectState.selectedIds.has(item.id);
                const imgHtml = `<img src="${meta.cover || ''}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0 shadow-sm item-cover-img-${item.id} ${meta.cover ? '' : 'hidden'}"><div class="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 text-blue-500 text-xl item-cover-icon-${item.id} ${meta.cover ? 'hidden' : ''}"><i class="fas fa-folder"></i></div>`;
                let checkUi = isSelected ? `<div class="absolute top-1/2 -translate-y-1/2 right-12 bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow"><i class="fas fa-check text-[10px]"></i></div>` : '';
                let bgClass = isSelected ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50';

                return `
                <div class="subfolder-row group relative border-b transition ${bgClass}" onclick="loadFolder('${item.id}', '${item.name}', true)">
                    ${checkUi} ${imgHtml}
                    <div class="flex-1 overflow-hidden" onclick="window.toggleFileSelection ? window.toggleFileSelection('${item.id}', event) : null">
                        <h4 class="text-sm font-bold ${isSelected ? 'text-blue-800' : 'text-gray-800'} truncate item-name-${item.id}">${item.name}</h4>
                        <p class="text-[11px] text-gray-500 truncate mt-0.5 item-desc-${item.id} ${meta.desc ? '' : 'hidden'}">${meta.desc || 'Chưa có mô tả'}</p>
                    </div>
                    <div class="relative" onclick="event.stopPropagation()">
                        <button onclick="window.toggleItemMenu('${item.id}', event)" class="px-3 py-2 text-gray-400"><i class="fas fa-ellipsis-v"></i></button>
                        <div id="menu-${item.id}" class="hidden absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-lg border z-[500] py-1 text-sm item-action-menu">
                            <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer font-semibold text-gray-700 flex items-center" onclick="window.shareItem('${item.id}', '${item.type}', '${item.name}', event)"><i class="fas fa-share-nodes mr-3 text-green-500 w-4"></i>Chia sẻ</div>
                            <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer font-semibold text-gray-700 flex items-center" onclick="window.openInfo('${item.id}', '${item.name}', '${item.type}', 'sub', event)"><i class="fas fa-pen mr-3 text-blue-500 w-4"></i>Sửa</div>
                            <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer font-semibold text-gray-700 border-t flex items-center" onclick="window.downloadItem('${item.id}', '${item.type}', '${item.name}', event)"><i class="fas fa-download mr-3 text-blue-500 w-4"></i>Tải xuống</div>
                            <div class="px-4 py-3 hover:bg-red-50 text-red-600 cursor-pointer font-semibold border-t flex items-center" onclick="window.handleDelete('${item.id}', '${item.type}', event)"><i class="fas fa-trash mr-3 w-4"></i>Xóa</div>
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        fileListEl.innerHTML = files.map(item => {
            let isImage = item.mimeType.includes('image'); let isSelected = window.multiSelectState && window.multiSelectState.selectedIds.has(item.id);
            let imgUrl = item.tempUrl ? item.tempUrl : `https://drive.google.com/thumbnail?id=${item.id}&sz=w400`; let fullImgUrl = item.tempUrl ? item.tempUrl : `https://drive.google.com/thumbnail?id=${item.id}&sz=w2000`;
            let visualEl = isImage ? `<img src="${imgUrl}" data-url="${fullImgUrl}" class="w-full h-full object-cover drive-img-item" loading="lazy">` : `<div class="w-full h-full flex items-center justify-center bg-gray-50"><i class="fas fa-play-circle text-gray-400 text-4xl"></i></div>`;
            let isTemp = item.tempUrl ? `<div class="absolute inset-0 bg-white/60 flex flex-col items-center justify-center backdrop-blur-[2px] z-10 rounded-2xl"><div class="loader mb-2 border-blue-600"></div><span class="text-[10px] font-bold text-blue-600">Đang Up...</span></div>` : '';
            let checkUi = isSelected ? `<div class="absolute top-2 left-2 z-20 bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-md"><i class="fas fa-check text-xs"></i></div>` : '';
            let borderClass = isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : 'border-gray-100 bg-white';

            return `
            <div class="p-2.5 rounded-2xl shadow-sm border flex flex-col relative transition ${borderClass}">
                ${checkUi} ${isTemp}
                <div class="absolute top-2 right-2 z-20">
                    <button onclick="window.toggleItemMenu('${item.id}', event)" class="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-600 bg-white/90 backdrop-blur-md rounded-full shadow-sm"><i class="fas fa-ellipsis-v"></i></button>
                    <div id="menu-${item.id}" class="hidden absolute right-0 mt-1 w-40 bg-white rounded-2xl shadow-xl border border-gray-100 z-[500] py-1 text-sm item-action-menu overflow-hidden">
                        <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold flex items-center" onclick="window.shareItem('${item.id}', '${item.type}', '${item.name}', event)"><i class="fas fa-share-nodes mr-3 text-green-500 w-4"></i>Chia sẻ</div>
                        <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold flex items-center" onclick="window.downloadItem('${item.id}', '${item.type}', '${item.name}', event)"><i class="fas fa-download mr-3 text-blue-500 w-4"></i>Tải xuống</div>
                        <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold border-t flex items-center" onclick="window.openInfo('${item.id}', '${item.name}', '${item.type}', 'file', event)"><i class="fas fa-pen mr-3 text-blue-500 w-4"></i>Sửa</div>
                        <div class="px-4 py-3 hover:bg-red-50 cursor-pointer text-red-600 font-semibold border-t flex items-center" onclick="window.handleDelete('${item.id}', '${item.type}', event)"><i class="fas fa-trash mr-3 w-4"></i>Xóa</div>
                    </div>
                </div>
                <div class="w-full h-32 flex items-center justify-center bg-gray-100 rounded-xl overflow-hidden cursor-pointer mb-3" onclick="openMedia('${item.id}', '${item.mimeType}', '${item.name}', '${fullImgUrl}')">${visualEl}</div>
                <div class="px-1 flex flex-col justify-center flex-1 cursor-pointer" onclick="window.toggleFileSelection ? window.toggleFileSelection('${item.id}', event) : null">
                    <span class="text-[13px] font-bold ${isSelected ? 'text-blue-700' : 'text-gray-800'} line-clamp-2 leading-tight drive-img-name item-name-${item.id}" title="${item.name}">${item.name}</span>
                    <span class="text-[10px] text-gray-400 mt-1 uppercase font-semibold">${item.mimeType.split('/')[1] || 'FILE'}</span>
                </div>
            </div>`;
        }).join('');
    }
};

(function () {
    let currentCols = parseInt(localStorage.getItem('vinhloc_grid_cols')) || 2;
    let initialPinchDistance = null; let isPinching = false;

    function updateGridColumns(newCols) {
        currentCols = Math.max(2, Math.min(newCols, 6)); const fileList = document.getElementById('fileList'); if (!fileList || fileList.classList.contains('list-view')) return;
        fileList.classList.remove('grid-cols-2'); fileList.style.gridTemplateColumns = `repeat(${currentCols}, minmax(0, 1fr))`;
        const scaleFactor = (2 / currentCols).toFixed(2); fileList.style.setProperty('--col-scale', scaleFactor); localStorage.setItem('vinhloc_grid_cols', currentCols);
    }
    document.addEventListener("DOMContentLoaded", () => updateGridColumns(currentCols));

    const touchArea = document.getElementById('contentArea');
    if (touchArea) {
        touchArea.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { isPinching = true; initialPinchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); } }, { passive: true });
        touchArea.addEventListener('touchmove', (e) => {
            if (!isPinching || e.touches.length !== 2) return; e.preventDefault();
            const currentDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            const diff = currentDistance - initialPinchDistance;
            if (Math.abs(diff) > 70) { if (diff > 0) updateGridColumns(currentCols - 1); else updateGridColumns(currentCols + 1); initialPinchDistance = currentDistance; }
        }, { passive: false });
        touchArea.addEventListener('touchend', (e) => { if (e.touches.length < 2) isPinching = false; });
    }

    // Grid Controls Design Tool
    document.addEventListener("DOMContentLoaded", () => {
        const designHeaderLeft = document.querySelector('#watermark-overlay-container header .header-icons:first-child');
        if (designHeaderLeft && !document.getElementById('design-grid-controls')) {
            const controlsContainer = document.createElement('div'); controlsContainer.id = 'design-grid-controls'; controlsContainer.className = 'flex items-center gap-2 ml-4';
            const btnDecrease = document.createElement('button'); btnDecrease.className = 'w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition shadow-sm border border-gray-200 active:bg-gray-300'; btnDecrease.innerHTML = '<i class="fas fa-minus text-xs"></i>'; btnDecrease.title = 'Giảm số cột (Phóng to)';
            const btnIncrease = document.createElement('button'); btnIncrease.className = 'w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition shadow-sm border border-gray-200 active:bg-gray-300'; btnIncrease.innerHTML = '<i class="fas fa-plus text-xs"></i>'; btnIncrease.title = 'Tăng số cột (Thu nhỏ)';
            controlsContainer.appendChild(btnDecrease); controlsContainer.appendChild(btnIncrease); designHeaderLeft.appendChild(controlsContainer);

            let designGridCols = 2; const imageGrid = document.getElementById('image-grid');
            const updateDesignGrid = () => { if (imageGrid) { imageGrid.style.columnCount = designGridCols; btnDecrease.style.opacity = designGridCols === 1 ? '0.4' : '1'; btnDecrease.style.pointerEvents = designGridCols === 1 ? 'none' : 'auto'; btnIncrease.style.opacity = designGridCols === 2 ? '0.4' : '1'; btnIncrease.style.pointerEvents = designGridCols === 2 ? 'none' : 'auto'; } };
            btnDecrease.addEventListener('click', () => { if (designGridCols > 1) { designGridCols--; updateDesignGrid(); } }); btnIncrease.addEventListener('click', () => { if (designGridCols < 2) { designGridCols++; updateDesignGrid(); } });
            updateDesignGrid();
        }
    });
})();

window.isDesignOverlayActive = false;
if (!window.originalLoadFolderForDesign) window.originalLoadFolderForDesign = window.loadFolder;
window.loadFolder = async function (folderId, folderName, isNewNavigation = false, isPopState = false) {
    if (window.isDesignOverlayActive && isPopState) { window.isDesignOverlayActive = false; const overlayContainer = document.getElementById('watermark-overlay-container'); if (overlayContainer) overlayContainer.style.display = 'none'; return; }
    return window.originalLoadFolderForDesign(folderId, folderName, isNewNavigation, isPopState);
};

const btnOpenDesignFix = document.getElementById('btn-open-design');
if (btnOpenDesignFix) {
    btnOpenDesignFix.addEventListener('click', () => {
        setTimeout(() => {
            const overlayContainer = document.getElementById('watermark-overlay-container');
            if (overlayContainer && overlayContainer.style.display === 'flex') { if (!window.isDesignOverlayActive) { window.isDesignOverlayActive = true; folderStack.push({ id: 'dummy_design_state', name: 'Design Mode', scrollTop: 0 }); history.pushState({ panel: 'design' }, '', ''); } }
        }, 50);
    });
}
const btnCloseDesignFix = document.getElementById('btn-close-design');
if (btnCloseDesignFix) {
    const newCloseBtn = btnCloseDesignFix.cloneNode(true); btnCloseDesignFix.parentNode.replaceChild(newCloseBtn, btnCloseDesignFix);
    newCloseBtn.addEventListener('click', () => {
        const overlayContainer = document.getElementById('watermark-overlay-container');
        if (window.isDesignOverlayActive) history.back(); else { if (overlayContainer) overlayContainer.style.display = 'none'; }
    });
}
// Cứu lại thanh Header của giao diện Design bằng cách đẩy nó lên lớp cao nhất
document.addEventListener("DOMContentLoaded", () => {
    const designContainer = document.getElementById('watermark-overlay-container');
    if (designContainer) designContainer.style.zIndex = '9999999';
});

// Chạy luôn lệnh này phòng trường hợp trang web đã load xong DOM
const activeDesignContainer = document.getElementById('watermark-overlay-container');
if (activeDesignContainer) activeDesignContainer.style.zIndex = '9999999';
// ==============================================================
// PATCH: INSTANT CACHE PERSISTENCE (LƯU TỨC THÌ 100% CHỐNG MẤT DỮ LIỆU)
// ==============================================================
setTimeout(() => {
    // 1. Chặn hành động vẽ lại danh sách chính: Cứ vẽ xong là lưu ổ cứng
    if (window.renderItems && !window.renderItems_isWrapped) {
        const originalRenderItems = window.renderItems;
        window.renderItems = function(items, isSearchMode = false) {
            originalRenderItems(items, isSearchMode);
            // Lưu thẳng vào ổ cứng ngay tắp lự (bỏ qua nếu đang search)
            if (!isSearchMode) {
                localforage.setItem('vinhloc_folder_cache', folderDataCache).catch(e=>{});
            }
        };
        window.renderItems_isWrapped = true;
    }

    // 2. Chặn hành động vẽ thư mục con (Mega folders): Vẽ xong là lưu ngay
    if (typeof window.renderSubFolders !== 'undefined' || typeof renderSubFolders !== 'undefined') {
        const targetFn = window.renderSubFolders || renderSubFolders;
        if (!targetFn.isWrapped) {
            const originalRenderSubFolders = targetFn;
            const newRenderSubFolders = function(megaId, subFolders) {
                originalRenderSubFolders(megaId, subFolders);
                localforage.setItem('vinhloc_subfolder_cache', subFolderCache).catch(e=>{});
            };
            newRenderSubFolders.isWrapped = true;
            if (window.renderSubFolders) window.renderSubFolders = newRenderSubFolders;
            else renderSubFolders = newRenderSubFolders; 
        }
    }

    // 3. Chặn hành động khi đổi tên file / đổi ảnh bìa
    if (typeof window.smoothUpdateUI !== 'undefined' || typeof smoothUpdateUI !== 'undefined') {
        const targetFn = window.smoothUpdateUI || smoothUpdateUI;
        if (!targetFn.isWrapped) {
            const originalSmoothUpdateUI = targetFn;
            const newSmoothUpdateUI = function(newMeta) {
                originalSmoothUpdateUI(newMeta);
                localforage.setItem('vinhloc_folder_cache', folderDataCache).catch(e=>{});
                localforage.setItem('vinhloc_subfolder_cache', subFolderCache).catch(e=>{});
            };
            newSmoothUpdateUI.isWrapped = true;
            if (window.smoothUpdateUI) window.smoothUpdateUI = newSmoothUpdateUI;
            else smoothUpdateUI = newSmoothUpdateUI;
        }
    }
}, 500);
// ==============================================================
// PATCH 4: BACKGROUND SYNC CHO CẤU TRÚC FILE/FOLDER (ĐA THIẾT BỊ)
// ==============================================================
window.silentFetchFolder = async function() {
    // 1. Dừng đồng bộ ngầm nếu: chưa có folder, đang ở giao diện Design, hoặc máy NÀY đang bận up file (tránh đụng độ)
    if (!currentFolderId || currentFolderId === 'dummy_design_state' || syncQueueCount > 0) return;
    
    // 2. Dừng đồng bộ nếu người dùng đang mở Menu 3 chấm hoặc Modal (để tránh bị giật mất Menu đang thao tác)
    const hasOpenMenu = document.querySelector('.item-action-menu:not(.hidden)');
    const hasOpenModal = !document.getElementById('customModal').classList.contains('hidden');
    if (hasOpenMenu || hasOpenModal) return;

    const targetFolderId = currentFolderId; // Giữ ID của thư mục lúc bắt đầu gọi
    
    try {
        // --- ĐỒNG BỘ 1: THƯ MỤC HIỆN TẠI ĐANG XEM ---
        const res = await fetch(SCRIPT_URL, { 
            method: 'POST', 
            body: JSON.stringify({ action: 'list', folderId: targetFolderId }) 
        }).then(r => r.json());

        if (res && res.success && res.data) {
            const newData = res.data;
            const oldData = folderDataCache[targetFolderId] || [];
            
            // Lọc bỏ các thư mục "ảo" (isPending) đang chờ tạo trên máy này ra khỏi phép so sánh
            const cleanOld = oldData.filter(i => !i.isPending);
            
            // So sánh thông minh: Nếu dữ liệu Drive khác với Cache nội bộ (có máy khác vừa thêm/xóa file)
            if (JSON.stringify(newData) !== JSON.stringify(cleanOld)) {
                
                // Cập nhật ngay vào ổ cứng
                folderDataCache[targetFolderId] = newData;
                localforage.setItem('vinhloc_folder_cache', folderDataCache).catch(e=>{});
                
                // Nếu người dùng vẫn đang đứng ở thư mục đó (chưa chuyển đi nơi khác), cập nhật giao diện
                if (currentFolderId === targetFolderId) {
                    currentDriveItems = newData;
                    // Hàm renderItems đã được thiết kế tối ưu, gọi lại sẽ thay thế đúng các node cần thiết
                    window.renderItems(currentDriveItems);
                }
            }
        }

        // --- ĐỒNG BỘ 2: ĐỒNG BỘ CÁC THƯ MỤC CON NẾU ĐANG Ở TRANG CHỦ ---
        // (Xử lý trường hợp người dùng đang xổ các Mega folder ở ngoài trang chủ Triển khai/Ý tưởng)
        if (folderStack.length === 1 && typeof expandedMegas !== 'undefined' && expandedMegas.length > 0) {
            for (let megaId of expandedMegas) {
                const subRes = await fetch(SCRIPT_URL, { 
                    method: 'POST', 
                    body: JSON.stringify({ action: 'list', folderId: megaId }) 
                }).then(r => r.json());
                
                if (subRes && subRes.success && subRes.data) {
                    const newSubData = subRes.data.filter(i => i.type === 'folder');
                    const oldSubData = (subFolderCache[megaId] || []).filter(i => !i.isPending);
                    
                    if (JSON.stringify(newSubData) !== JSON.stringify(oldSubData)) {
                        subFolderCache[megaId] = newSubData;
                        localforage.setItem('vinhloc_subfolder_cache', subFolderCache).catch(e=>{});
                        
                        // Chỉ vẽ lại đúng cái khối sub-folder bị thay đổi
                        if (typeof renderSubFolders === 'function') {
                            renderSubFolders(megaId, newSubData);
                        } else if (window.renderSubFolders) {
                            window.renderSubFolders(megaId, newSubData);
                        }
                    }
                }
            }
        }

    } catch (err) {
        // Lỗi ngầm (mất mạng chập chờn) -> bỏ qua không làm phiền người dùng
    }
};
// ==============================================================
// PATCH 5: SỬA LỖI ĐỔI ẢNH BÌA & GIỮ CHẶT MÔ TẢ TRÊN MOBILE
// ==============================================================

// 1. Ép ảnh nén xong 100% ngay lúc chọn file (Khắc phục CPU điện thoại chậm)
window.handleCoverUpload = function(event) {
    const file = event.target.files[0]; 
    if (!file) return; 
    
    showToast('<i class="fas fa-spinner fa-spin mr-2"></i> Đang nén ảnh...');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            try {
                const canvas = document.createElement('canvas'); 
                let width = img.width; 
                let height = img.height; 
                const MAX_SIZE = 800; // Resize về 800px cho nhẹ
                
                if (width > height) { 
                    if (width > MAX_SIZE) { height = Math.round(height * (MAX_SIZE / width)); width = MAX_SIZE; } 
                } else { 
                    if (height > MAX_SIZE) { width = Math.round(width * (MAX_SIZE / height)); height = MAX_SIZE; } 
                }
                
                canvas.width = width; canvas.height = height; 
                const ctx = canvas.getContext('2d'); 
                ctx.fillStyle = '#ffffff'; 
                ctx.fillRect(0, 0, width, height); 
                ctx.drawImage(img, 0, 0, width, height);
                
                // Nén ra Base64 chất lượng 80%
                const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8); 
                
                document.getElementById('infoCoverPreview').src = compressedDataUrl; 
                document.getElementById('infoCoverPreview').classList.remove('hidden'); 
                document.getElementById('infoCoverPlaceholder').classList.add('hidden');
                
                window.pendingCoverBase64 = compressedDataUrl.split(',')[1]; 
                window.pendingCoverMimeType = 'image/jpeg';
                
            } catch (err) {
                // Fallback an toàn nếu trình duyệt mobile không hỗ trợ canvas tốt
                document.getElementById('infoCoverPreview').src = e.target.result;
                window.pendingCoverBase64 = e.target.result.split(',')[1];
                window.pendingCoverMimeType = file.type || 'image/jpeg';
            }
        };
        img.src = e.target.result;
    }; 
    reader.readAsDataURL(file);
};

// 2. Chặn đồng bộ ngầm đè giao diện khi đang Lưu (Giữ chặt UI)
setTimeout(() => {
    const oldSaveBtn = document.getElementById('infoSaveBtn');
    if(oldSaveBtn) {
        const newSaveBtn = oldSaveBtn.cloneNode(true);
        oldSaveBtn.parentNode.replaceChild(newSaveBtn, oldSaveBtn);
        newSaveBtn.onclick = async () => { 
            if(!currentEditId) return closeInfoModal();
            
            const newName = document.getElementById('infoName').value.trim(); 
            const newType = document.getElementById('infoType').value; 
            const newDesc = document.getElementById('infoDesc').value.trim();
            
            let newCover = appMeta[currentEditId]?.cover || ''; 
            let pendingB64 = window.pendingCoverBase64; 
            let pendingMime = window.pendingCoverMimeType; 
            let tempCoverUrl = document.getElementById('infoCoverPreview').src;
            
            // Cập nhật UI NGAY LẬP TỨC để người dùng thấy mượt
            if (pendingB64) newCover = tempCoverUrl;
            appMeta[currentEditId] = { type: newType, desc: newDesc, cover: newCover, name: newName };
            localforage.setItem('vinhloc_meta', appMeta).catch(e=>{});
            
            let nameChanged = false; 
            // Gom tất cả các mảng cache để tìm thư mục đang sửa
            const allItems = [...currentDriveItems, ...Object.values(subFolderCache).flat()];
            const oldItem = allItems.find(i => i.id === currentEditId);
            if (newName && oldItem && newName !== oldItem.name) { nameChanged = true; }
            
            smoothUpdateUI(appMeta); 
            closeInfoModal();
            
            // --- CỰC KỲ QUAN TRỌNG: KHÓA BACKGROUND SYNC (GIỮ GIAO DIỆN) ---
            syncQueueCount++; updateSyncIndicator();
            
            try {
                if (pendingB64) {
                    window.pendingCoverBase64 = null; window.pendingCoverMimeType = null;
                    showToast(`<i class="fas fa-cloud-upload-alt mr-2 text-blue-400"></i> Đang up ảnh bìa...`);
                    
                    // Upload trực tiếp và chờ kết quả từ Drive
                    const res = await fetch(SCRIPT_URL, { 
                        method: 'POST', 
                        body: JSON.stringify({ action: 'upload', folderId: currentEditId, filename: '_cover.jpg', mimeType: pendingMime, data: pendingB64 }) 
                    }).then(r => r.json());
                    
                    if (res && res.success) {
                        let permanentCover = `https://drive.google.com/thumbnail?id=${res.fileId || res.id}&sz=w800`;
                        appMeta[currentEditId].cover = permanentCover; 
                        localforage.setItem('vinhloc_meta', appMeta).catch(e=>{}); 
                        
                        // Chuyển êm ái từ ảnh mờ sang link ảnh xịn của Drive
                        smoothUpdateUI(appMeta);
                        
                        // Đẩy Mô tả và Tên vào Queue chạy ngầm
                        addActionToQueue('updateSingleMeta', { meta: { id: currentEditId, name: newName, type: newType, desc: newDesc, cover: permanentCover } });
                        showToast(`<i class="fas fa-check mr-2 text-green-400"></i> Đã lưu thư mục`);
                    } else {
                        showToast('Lỗi tải ảnh bìa lên Drive!', true);
                    }
                } else {
                    showToast(`<i class="fas fa-check mr-2 text-green-400"></i> Đã lưu thư mục`);
                    addActionToQueue('updateSingleMeta', { meta: { id: currentEditId, name: newName, type: newType, desc: newDesc, cover: newCover } });
                }

                if (nameChanged) addActionToQueue('rename', { id: currentEditId, newName: newName, type: currentEditType });
                
            } catch (err) {
                console.error(err);
            } finally {
                // --- MỞ KHÓA BACKGROUND SYNC ---
                syncQueueCount--; updateSyncIndicator();
            }
        };
    }
}, 1000); // Khởi tạo sau 1s để đảm bảo đè lên các bản cũ
// ==============================================================
// PATCH 6: TRỊ DỨT ĐIỂM LỖI ẢNH ĐIỆN THOẠI & LỖI BIẾN MẤT UI
// ==============================================================

// 1. SỬA LỖI TRÀN RAM ĐIỆN THOẠI & KHÓA NÚT LƯU TRONG LÚC NÉN
window.handleCoverUpload = async function(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Khóa nút Lưu để người dùng không bấm được lúc đang nén
    const saveBtn = document.getElementById('infoSaveBtn');
    const oldSaveText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Đang xử lý ảnh...';
    saveBtn.classList.add('opacity-50', 'cursor-not-allowed');

    try {
        // Dùng createObjectURL để không làm đơ trình duyệt mobile
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        // Bắt buộc phải ĐỢI ảnh tải lên bộ nhớ tạm xong mới làm tiếp
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = objectUrl;
        });

        const canvas = document.createElement('canvas');
        let width = img.width; let height = img.height;
        const MAX_SIZE = 600; // Giảm xuống 600px để mọi điện thoại đều mượt

        if (width > height) {
            if (width > MAX_SIZE) { height = Math.round(height * (MAX_SIZE / width)); width = MAX_SIZE; }
        } else {
            if (height > MAX_SIZE) { width = Math.round(width * (MAX_SIZE / height)); height = MAX_SIZE; }
        }

        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);

        // Hiển thị ảnh nén lên giao diện
        document.getElementById('infoCoverPreview').src = compressedDataUrl;
        document.getElementById('infoCoverPreview').classList.remove('hidden');
        document.getElementById('infoCoverPlaceholder').classList.add('hidden');

        // Lưu vào biến toàn cục để chuẩn bị up lên Drive
        window.pendingCoverBase64 = compressedDataUrl.split(',')[1];
        window.pendingCoverMimeType = 'image/jpeg';

        URL.revokeObjectURL(objectUrl); // Giải phóng RAM điện thoại
    } catch (err) {
        showToast("Lỗi xử lý ảnh, hãy thử ảnh khác!", true);
        console.error(err);
    } finally {
        // Xử lý xong -> Mở khóa nút Lưu
        saveBtn.disabled = false;
        saveBtn.innerHTML = oldSaveText;
        saveBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
};

// 2. CHẶN SHEETS LẤY DỮ LIỆU CŨ ĐÈ LÊN GIAO DIỆN (GHOST OVERWRITE)
window.lastEditTime = 0; // Biến ghi nhớ thời điểm vừa sửa file

setTimeout(() => {
    const oldSaveBtn = document.getElementById('infoSaveBtn');
    if(oldSaveBtn) {
        const newSaveBtn = oldSaveBtn.cloneNode(true);
        oldSaveBtn.parentNode.replaceChild(newSaveBtn, oldSaveBtn);
        newSaveBtn.onclick = async () => { 
            if(!currentEditId) return closeInfoModal();
            
            // Đánh dấu thời điểm người dùng vừa bấm lưu!
            window.lastEditTime = Date.now(); 
            
            const newName = document.getElementById('infoName').value.trim(); 
            const newType = document.getElementById('infoType').value; 
            const newDesc = document.getElementById('infoDesc').value.trim();
            
            let newCover = appMeta[currentEditId]?.cover || ''; 
            let pendingB64 = window.pendingCoverBase64; 
            let pendingMime = window.pendingCoverMimeType; 
            let tempCoverUrl = document.getElementById('infoCoverPreview').src;
            
            // Dù đang có mạng hay không, LƯU NGAY vào ổ cứng và HIỆN UI TỨC THÌ
            if (pendingB64) newCover = tempCoverUrl; 
            appMeta[currentEditId] = { type: newType, desc: newDesc, cover: newCover, name: newName };
            localforage.setItem('vinhloc_meta', appMeta).catch(e=>{});
            
            let nameChanged = false; 
            const allItems = [...currentDriveItems, ...Object.values(subFolderCache).flat()];
            const oldItem = allItems.find(i => i.id === currentEditId);
            if (newName && oldItem && newName !== oldItem.name) { nameChanged = true; }
            
            smoothUpdateUI(appMeta); 
            closeInfoModal();
            
            // Bật cờ cấm mọi hành động tải ngầm phá đám
            syncQueueCount++; updateSyncIndicator();
            
            try {
                if (pendingB64) {
                    window.pendingCoverBase64 = null; window.pendingCoverMimeType = null;
                    showToast(`<i class="fas fa-cloud-upload-alt mr-2 text-blue-400"></i> Đang up ảnh bìa...`);
                    
                    const res = await fetch(SCRIPT_URL, { 
                        method: 'POST', 
                        body: JSON.stringify({ action: 'upload', folderId: currentEditId, filename: '_cover.jpg', mimeType: pendingMime, data: pendingB64 }) 
                    }).then(r => r.json());
                    
                    if (res && res.success) {
                        let permanentCover = `https://drive.google.com/thumbnail?id=${res.fileId || res.id}&sz=w800`;
                        appMeta[currentEditId].cover = permanentCover; 
                        localforage.setItem('vinhloc_meta', appMeta).catch(e=>{}); 
                        smoothUpdateUI(appMeta); // Gắn link Drive thật vào
                        
                        addActionToQueue('updateSingleMeta', { meta: { id: currentEditId, name: newName, type: newType, desc: newDesc, cover: permanentCover } });
                        showToast(`<i class="fas fa-check mr-2 text-green-400"></i> Đã lưu thư mục`);
                    } else {
                        showToast('Lỗi tải ảnh bìa lên Drive!', true);
                    }
                } else {
                    showToast(`<i class="fas fa-check mr-2 text-green-400"></i> Đã lưu thư mục`);
                    addActionToQueue('updateSingleMeta', { meta: { id: currentEditId, name: newName, type: newType, desc: newDesc, cover: newCover } });
                }

                if (nameChanged) addActionToQueue('rename', { id: currentEditId, newName: newName, type: currentEditType });
                
            } catch (err) {
                console.error(err);
            } finally {
                syncQueueCount--; updateSyncIndicator();
            }
        };
    }
}, 1500); // 1.5s để đảm bảo ghi đè các hàm cũ

// 3. BỌC HÀM ĐỒNG BỘ: NHẮM MẮT LÀM NGƠ KHI VỪA SỬA XONG
if (typeof silentFetchMeta === 'function' && !silentFetchMeta.isWrappedForGracePeriod) {
    const originalSilentFetchMeta = silentFetchMeta;
    silentFetchMeta = async function() {
        // Nếu vừa mới lưu, BỎ QUA không lấy dữ liệu từ Google Sheets trong 15 giây
        // (Chờ Sheets cập nhật xong xuôi rồi mới được lấy lại)
        if (Date.now() - window.lastEditTime < 15000) {
            return;
        }
        return originalSilentFetchMeta();
    };
    silentFetchMeta.isWrappedForGracePeriod = true;
}
// ==============================================================
// THE ULTIMATE FIX: LÀM SẠCH VÀ TÁI THIẾT LẬP TOÀN BỘ ĐỒNG BỘ
// ==============================================================
setTimeout(() => {
    console.log("🚀 Đang khởi động TỔNG CHỈ HUY ĐỒNG BỘ...");

    // 1. TIÊU DIỆT TOÀN BỘ CÁC HÀM ĐỒNG BỘ CŨ (XÓA SẠCH RÁC)
    window.silentFetchFolder = async function() {};
    window.silentFetchMeta = async function() {};
    if (window.masterSyncInterval) clearInterval(window.masterSyncInterval);

    // 2. NÂNG CẤP HÀM CẬP NHẬT GIAO DIỆN (CỤC BỘ, KHÔNG LOAD LẠI TRANG)
    window.smoothUpdateUI = function(newMeta) {
        for (let id in newMeta) {
            const meta = newMeta[id];
            
            // Cập nhật mảng Dữ liệu gốc
            const allItems = [...currentDriveItems, ...(Object.values(subFolderCache).flat())];
            const target = allItems.find(i => i.id === id);
            if (target && meta.name) target.name = meta.name;

            // Đổi Tên trên HTML
            document.querySelectorAll(`.item-name-${id}`).forEach(el => {
                if (meta.name && el.textContent !== meta.name) { el.textContent = meta.name; el.title = meta.name; }
            });
            // Đổi Mô tả trên HTML
            document.querySelectorAll(`.item-desc-${id}`).forEach(el => {
                const newDesc = meta.desc || 'Chưa có mô tả';
                if (el.textContent !== newDesc) el.textContent = newDesc;
                if(meta.desc) el.classList.remove('hidden'); else el.classList.add('hidden');
            });
            // Đổi Ảnh bìa trên HTML
            document.querySelectorAll(`.item-cover-img-${id}`).forEach(img => {
                const icon = document.querySelector(`.item-cover-icon-${id}`);
                if (meta.cover) {
                    if(img.src !== meta.cover) img.src = meta.cover;
                    img.classList.remove('hidden'); if(icon) icon.classList.add('hidden');
                } else {
                    img.classList.add('hidden'); if(icon) icon.classList.remove('hidden');
                }
            });

            // Đổi Loại (Triển khai/Ý tưởng) - Bay mượt mà sang Tab khác mà không cần Load lại web!
            if (folderStack.length === 1) {
                const headerIcon = document.getElementById(`icon-${id}`);
                if (headerIcon) {
                    const row = headerIcon.closest('.mega-row');
                    if (row) {
                        // Nếu Loại không khớp với Tab đang xem, ẩn thư mục đó đi
                        if (meta.type !== currentCategory) {
                            row.style.display = 'none'; 
                        } else {
                            row.style.display = 'block'; 
                        }
                    }
                }
            }
        }
    };

    // 3. THAY MỚI HOÀN TOÀN NÚT LƯU TRONG CÀI ĐẶT
    const oldSaveBtn = document.getElementById('infoSaveBtn');
    if(oldSaveBtn) {
        const newSaveBtn = oldSaveBtn.cloneNode(true);
        oldSaveBtn.parentNode.replaceChild(newSaveBtn, oldSaveBtn);

        newSaveBtn.onclick = async () => { 
            if(!currentEditId) return closeInfoModal();
            
            // Cắm cờ báo hiệu "Vừa sửa xong, cấm ai làm phiền trong 15s"
            window.lastEditTime = Date.now(); 
            
            // Gom tất cả thông tin lại
            const newName = document.getElementById('infoName').value.trim(); 
            const newType = document.getElementById('infoType').value; 
            const newDesc = document.getElementById('infoDesc').value.trim();
            
            let newCover = appMeta[currentEditId]?.cover || ''; 
            let pendingB64 = window.pendingCoverBase64; 
            let pendingMime = window.pendingCoverMimeType; 
            let tempCoverUrl = document.getElementById('infoCoverPreview').src;
            
            if (pendingB64) newCover = tempCoverUrl; 
            
            // A. LƯU VÀO MÁY BẢN THÂN VÀ HIỂN THỊ NGAY LẬP TỨC
            appMeta[currentEditId] = { type: newType, desc: newDesc, cover: newCover, name: newName };
            localforage.setItem('vinhloc_meta', appMeta).catch(()=>{});
            
            let nameChanged = false; 
            const allItems = [...currentDriveItems, ...Object.values(subFolderCache).flat()];
            const oldItem = allItems.find(i => i.id === currentEditId);
            if (newName && oldItem && newName !== oldItem.name) { 
                nameChanged = true; 
                // Ép lưu tên mới vào Cache cấu trúc để chống lỗi
                oldItem.name = newName;
                localforage.setItem('vinhloc_folder_cache', folderDataCache).catch(()=>{});
            }
            
            smoothUpdateUI(appMeta); // Giao diện đổi ngay lập tức, cực êm!
            closeInfoModal();
            
            // B. ĐẨY LÊN SERVER CHẠY NGẦM
            syncQueueCount++; updateSyncIndicator();
            try {
                if (pendingB64) {
                    window.pendingCoverBase64 = null; window.pendingCoverMimeType = null;
                    showToast(`<i class="fas fa-cloud-upload-alt mr-2 text-blue-400"></i> Đang up ảnh bìa...`);
                    
                    const res = await fetch(SCRIPT_URL, { 
                        method: 'POST', body: JSON.stringify({ action: 'upload', folderId: currentEditId, filename: '_cover.jpg', mimeType: pendingMime, data: pendingB64 }) 
                    }).then(r => r.json());
                    
                    if (res && res.success) {
                        let permanentCover = `https://drive.google.com/thumbnail?id=${res.fileId || res.id}&sz=w800`;
                        appMeta[currentEditId].cover = permanentCover; 
                        localforage.setItem('vinhloc_meta', appMeta).catch(()=>{}); 
                        smoothUpdateUI(appMeta); // Đổi URL tạm thành URL thật
                        
                        addActionToQueue('updateSingleMeta', { meta: { id: currentEditId, name: newName, type: newType, desc: newDesc, cover: permanentCover } });
                        showToast(`<i class="fas fa-check mr-2 text-green-400"></i> Đã lưu thư mục!`);
                    } else {
                        showToast('Lỗi tải ảnh bìa!', true);
                    }
                } else {
                    showToast(`<i class="fas fa-check mr-2 text-green-400"></i> Đã lưu thư mục!`);
                    addActionToQueue('updateSingleMeta', { meta: { id: currentEditId, name: newName, type: newType, desc: newDesc, cover: newCover } });
                }

                if (nameChanged) addActionToQueue('rename', { id: currentEditId, newName: newName, type: currentEditType });
            } catch (err) {
            } finally {
                syncQueueCount--; updateSyncIndicator();
            }
        };
    }

    // 4. HỆ THỐNG TỔNG CHỈ HUY ĐỒNG BỘ ĐA THIẾT BỊ (THE MASTER SYNC)
    window.masterSync = async function() {
        // Quy tắc vàng: Không lấy dữ liệu lúc đang up file, đang làm việc, hoặc vừa sửa xong
        if (syncQueueCount > 0 || (window.lastEditTime && Date.now() - window.lastEditTime < 15000)) return;
        if (document.querySelector('.item-action-menu:not(.hidden)') || !document.getElementById('customModal').classList.contains('hidden') || !document.getElementById('infoModal').classList.contains('hidden')) return;

        try {
            // Bước 1: Kéo Meta (Tên, Loại, Mô tả, Ảnh) từ Google Sheets
            const metaRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getMeta' }) }).then(r => r.json());
            if (metaRes && metaRes.success && metaRes.meta) {
                if (JSON.stringify(appMeta) !== JSON.stringify(metaRes.meta)) {
                    appMeta = metaRes.meta; 
                    localforage.setItem('vinhloc_meta', appMeta).catch(()=>{});
                    smoothUpdateUI(appMeta); // Lệnh thần thánh tự tìm chỗ khác biệt để cập nhật cục bộ
                }
            }

            // Bước 2: Kéo cấu trúc thư mục từ Google Drive
            if (currentFolderId && currentFolderId !== 'dummy_design_state') {
                const listRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'list', folderId: currentFolderId }) }).then(r => r.json());
                if (listRes && listRes.success && listRes.data) {
                    let newData = listRes.data;
                    
                    // ÉP Drive phải dùng Tên do Sheets quản lý để chống nháy!
                    newData.forEach(item => { if (appMeta[item.id] && appMeta[item.id].name) item.name = appMeta[item.id].name; });
                    
                    const oldData = (folderDataCache[currentFolderId] || []).filter(i => !i.isPending);
                    
                    if (JSON.stringify(newData) !== JSON.stringify(oldData)) {
                        folderDataCache[currentFolderId] = newData;
                        localforage.setItem('vinhloc_folder_cache', folderDataCache).catch(()=>{});
                        
                        // Chỉ vẽ lại UI nếu SỐ LƯỢNG file thực sự thay đổi (ai đó mới thêm/xóa file)
                        if (currentDriveItems.length !== newData.length) {
                            currentDriveItems = newData;
                            window.renderItems(currentDriveItems);
                        }
                    }
                }
            }
        } catch(e) {}
    };

    // Kích hoạt radar: 6 giây quét 1 lần!
    window.masterSyncInterval = setInterval(window.masterSync, 6000);
    console.log("✅ Tổng chỉ huy đồng bộ đã hoạt động mượt mà!");

}, 3000); // 3 giây để đảm bảo ghi đè mọi thứ
// ==============================================================
// BẢN HOÀN THIỆN: ĐỒNG BỘ 100% THÊM/SỬA/XÓA MỌI CẤP ĐỘ
// ==============================================================
setTimeout(() => {
    // Tắt rada cũ để cập nhật bản nâng cấp
    if (window.masterSyncInterval) clearInterval(window.masterSyncInterval);

    window.masterSync = async function() {
        // Không làm phiền khi máy đang up file hoặc vừa sửa xong chưa đầy 15s
        if (syncQueueCount > 0 || (window.lastEditTime && Date.now() - window.lastEditTime < 15000)) return;
        if (document.querySelector('.item-action-menu:not(.hidden)') || !document.getElementById('customModal').classList.contains('hidden') || !document.getElementById('infoModal').classList.contains('hidden')) return;

        try {
            // ---------------------------------------------------------
            // 1. ĐỒNG BỘ CHỨC NĂNG "SỬA" (Tên, Loại, Ảnh, Mô tả) TỪ SHEETS
            // ---------------------------------------------------------
            const metaRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getMeta' }) }).then(r => r.json());
            if (metaRes && metaRes.success && metaRes.meta) {
                if (JSON.stringify(appMeta) !== JSON.stringify(metaRes.meta)) {
                    appMeta = metaRes.meta; 
                    localforage.setItem('vinhloc_meta', appMeta).catch(()=>{});
                    smoothUpdateUI(appMeta); // Xử lý đổi tên, đổi ảnh, bay qua tab khác mượt mà
                }
            }

            // HÀM BÍ QUYẾT: So sánh chính xác ID để biết có file nào bị XÓA hoặc được THÊM không
            const hasStructureChanged = (oldArr, newArr) => {
                const oldIds = oldArr.filter(i => !i.isPending).map(i => i.id).sort().join(',');
                const newIds = newArr.map(i => i.id).sort().join(',');
                return oldIds !== newIds; // Trả về true nếu ID bên trong bị thay đổi
            };

            // ---------------------------------------------------------
            // 2. ĐỒNG BỘ CHỨC NĂNG "THÊM/XÓA" CHO GIAO DIỆN ĐANG XEM
            // (Bao gồm cả việc thêm/xóa Mega-row ở trang chủ, và File/Folder bên trong)
            // ---------------------------------------------------------
            if (currentFolderId && currentFolderId !== 'dummy_design_state') {
                const listRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'list', folderId: currentFolderId }) }).then(r => r.json());
                if (listRes && listRes.success && listRes.data) {
                    let newData = listRes.data;
                    // Ép Tên từ Sheets vào Drive để chống nháy
                    newData.forEach(item => { if (appMeta[item.id] && appMeta[item.id].name) item.name = appMeta[item.id].name; });
                    
                    const oldData = folderDataCache[currentFolderId] || [];
                    
                    // NẾU PHÁT HIỆN CÓ SỰ THÊM/XÓA FILE HOẶC FOLDER
                    if (hasStructureChanged(oldData, newData)) {
                        folderDataCache[currentFolderId] = newData;
                        localforage.setItem('vinhloc_folder_cache', folderDataCache).catch(()=>{});
                        currentDriveItems = newData;
                        window.renderItems(currentDriveItems); // Vẽ lại để làm xuất hiện mục mới
                    }
                }
            }

            // ---------------------------------------------------------
            // 3. ĐỒNG BỘ CHỨC NĂNG "THÊM/XÓA" CHO CÁC THƯ MỤC ĐANG XỔ XUỐNG
            // ---------------------------------------------------------
            if (folderStack.length === 1 && typeof expandedMegas !== 'undefined' && expandedMegas.length > 0) {
                for (let megaId of expandedMegas) {
                    const subRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'list', folderId: megaId }) }).then(r => r.json());
                    if (subRes && subRes.success && subRes.data) {
                        let newSubData = subRes.data.filter(i => i.type === 'folder');
                        newSubData.forEach(item => { if (appMeta[item.id] && appMeta[item.id].name) item.name = appMeta[item.id].name; });
                        
                        const oldSubData = subFolderCache[megaId] || [];
                        
                        if (hasStructureChanged(oldSubData, newSubData)) {
                            subFolderCache[megaId] = newSubData;
                            localforage.setItem('vinhloc_subfolder_cache', subFolderCache).catch(()=>{});
                            // Chỉ vẽ lại đúng cái khối Sub-folder bị ai đó xóa/thêm
                            if (typeof renderSubFolders === 'function') renderSubFolders(megaId, newSubData);
                            else if (window.renderSubFolders) window.renderSubFolders(megaId, newSubData);
                        }
                    }
                }
            }
        } catch(e) {}
    };

    // Bật lại rada quét 6 giây / lần
    window.masterSyncInterval = setInterval(window.masterSync, 6000);
    console.log("✅ Hệ thống đã bao phủ 100% chức năng Thêm, Sửa, Xóa!");

}, 4000);
// ==============================================================
// PATCH 12: ĐA UPLOAD (NHIỀU FILE) & ĐÓNG BĂNG UI ĐANG UP CHUẨN 100%
// ==============================================================
setTimeout(() => {
    // ---------------------------------------------------------
    // 1. MỞ KHÓA CHỌN NHIỀU FILE CÙNG LÚC (MULTIPLE: TRUE)
    // ---------------------------------------------------------
    async function pickLocalFilesMultiple({ accept = 'image/*', callback }) {
        try {
            if(window.showOpenFilePicker) {
                const pickerTypes = [];
                if(accept.includes('image')) pickerTypes.push({ description: 'Images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'] } });
                if(accept.includes('video')) pickerTypes.push({ description: 'Videos', accept: { 'video/*': ['.mp4', '.mov', '.webm', '.mkv'] } });
                
                // MỞ KHÓA CHO PHÉP CHỌN NHIỀU
                const handles = await window.showOpenFilePicker({ multiple: true, excludeAcceptAllOption: true, types: pickerTypes });
                const files = []; for(const handle of handles) files.push(await handle.getFile());
                callback({ target: { files } }); return;
            }
        } catch(err) {}
        
        const input = document.createElement('input'); 
        input.type = 'file'; 
        input.accept = accept; 
        input.multiple = true; // MỞ KHÓA CHO ĐIỆN THOẠI
        input.style.display = 'none';
        document.body.appendChild(input); 
        input.addEventListener('change', callback); 
        input.click(); 
        setTimeout(()=>{ input.remove(); }, 10000);
    }

    // Gắn lại sự kiện cho nút Up Ảnh & Video
    const uploadImageLabel = document.querySelector('label:has(#uploadImage)');
    if(uploadImageLabel) uploadImageLabel.onclick = async function(e){ e.preventDefault(); e.stopPropagation(); await pickLocalFilesMultiple({ accept:'image/*', callback: window.handleMultipleFileUpload }); };

    const uploadVideoLabel = document.querySelector('label:has(#uploadVideo)');
    if(uploadVideoLabel) uploadVideoLabel.onclick = async function(e){ e.preventDefault(); e.stopPropagation(); await pickLocalFilesMultiple({ accept:'video/*', callback: window.handleMultipleFileUpload }); };

    // ---------------------------------------------------------
    // 2. XỬ LÝ UP NHIỀU FILE & GẮN CHẶT LÊN GIAO DIỆN
    // ---------------------------------------------------------
    window.handleMultipleFileUpload = async function(event) {
        if (typeof closeFab === 'function') closeFab(); 
        const files = event.target.files; 
        if (!files || files.length === 0) return;
        
        syncQueueCount++; updateSyncIndicator(); 
        let uploadQueue = [];
        
        // BƯỚC 1: XẾP TOÀN BỘ FILE LÊN MÀN HÌNH CÙNG LÚC (Giao diện Lạc quan)
        for (let i = 0; i < files.length; i++) {
            let file = files[i]; 
            let fakeId = 'temp_file_' + Date.now() + '_' + i; 
            let tempUrl = URL.createObjectURL(file); 
            
            // CỜ QUAN TRỌNG: isPending = true để Cỗ máy đồng bộ không được xóa
            let newItem = { id: fakeId, name: file.name, mimeType: file.type, type: 'file', tempUrl: tempUrl, isPending: true };
            uploadQueue.push({ file: file, id: fakeId, itemRef: newItem }); 
            
            currentDriveItems.unshift(newItem); 
        }
        
        // Cập nhật giao diện nội bộ và in ra màn hình NGAY LẬP TỨC
        folderDataCache[currentFolderId] = currentDriveItems; 
        window.renderItems(currentDriveItems);
        
        // BƯỚC 2: UP TỪNG FILE NGẦM VÀ GỠ BỎ MÀN MỜ KHI XONG
        for (let obj of uploadQueue) {
            try {
                let base64Data = await new Promise((resolve, reject) => { 
                    let reader = new FileReader(); 
                    reader.onload = (e) => resolve(e.target.result.split(',')[1]); 
                    reader.onerror = (e) => reject(e); 
                    reader.readAsDataURL(obj.file); 
                });
                
                let res = await fetch(SCRIPT_URL, { 
                    method: 'POST', 
                    body: JSON.stringify({ action: 'upload', folderId: currentFolderId, filename: obj.file.name, mimeType: obj.file.type, data: base64Data }) 
                }).then(r => r.json());
                
                if (res && res.success) { 
                    let realId = res.fileId || res.id;
                    
                    // Xóa màn mờ "Đang up..." và cấp ID thật cho file
                    let uploadedItem = currentDriveItems.find(i => i.id === obj.id);
                    if (uploadedItem) {
                        uploadedItem.id = realId;
                        delete uploadedItem.isPending; // Xóa cờ bảo vệ
                        delete uploadedItem.tempUrl;   // Tắt hiệu ứng mờ
                    }
                    
                    if (folderDataCache[currentFolderId]) {
                        let cacheItem = folderDataCache[currentFolderId].find(i => i.id === obj.id);
                        if (cacheItem) {
                            cacheItem.id = realId;
                            delete cacheItem.isPending;
                            delete cacheItem.tempUrl;
                        }
                    }
                    
                    window.renderItems(currentDriveItems); // F5 cục bộ khối hình đó
                    URL.revokeObjectURL(obj.itemRef.tempUrl); 
                } else {
                    throw new Error("Lỗi Server!");
                }
            } catch(err) { 
                showToast(`Lỗi tải lên: ${obj.file.name}`, true); 
                // Nếu up rớt, tự động dọn dẹp khối hình lỗi khỏi màn hình
                currentDriveItems = currentDriveItems.filter(i => i.id !== obj.id); 
                folderDataCache[currentFolderId] = currentDriveItems;
                window.renderItems(currentDriveItems);
            }
        }
        
        syncQueueCount--; updateSyncIndicator();
        event.target.value = ''; 
    };

    // ---------------------------------------------------------
    // 3. ÉP CỖ MÁY ĐỒNG BỘ PHẢI TÔN TRỌNG CÁC FILE ĐANG UP
    // ---------------------------------------------------------
    if (window.masterSyncInterval) clearInterval(window.masterSyncInterval);

    window.masterSync = async function() {
        if (syncQueueCount > 0 || (window.lastEditTime && Date.now() - window.lastEditTime < 15000)) return;
        if (document.querySelector('.item-action-menu:not(.hidden)') || !document.getElementById('customModal').classList.contains('hidden') || !document.getElementById('infoModal').classList.contains('hidden')) return;

        try {
            const metaRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getMeta' }) }).then(r => r.json());
            if (metaRes && metaRes.success && metaRes.meta) {
                if (JSON.stringify(appMeta) !== JSON.stringify(metaRes.meta)) {
                    appMeta = metaRes.meta; 
                    localforage.setItem('vinhloc_meta', appMeta).catch(()=>{});
                    smoothUpdateUI(appMeta); 
                }
            }

            const hasStructureChanged = (oldArr, newArr) => {
                // Che mắt hàm đếm: Không tính các file đang có chữ Đang up...
                const oldIds = oldArr.filter(i => !i.isPending).map(i => i.id).sort().join(',');
                const newIds = newArr.filter(i => !i.isPending).map(i => i.id).sort().join(',');
                return oldIds !== newIds; 
            };

            if (currentFolderId && currentFolderId !== 'dummy_design_state') {
                const listRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'list', folderId: currentFolderId }) }).then(r => r.json());
                if (listRes && listRes.success && listRes.data) {
                    let newData = listRes.data;
                    newData.forEach(item => { if (appMeta[item.id] && appMeta[item.id].name) item.name = appMeta[item.id].name; });
                    
                    const oldData = folderDataCache[currentFolderId] || [];
                    
                    // NẾU PHÁT HIỆN CÓ AI ĐÓ THÊM XÓA FILE:
                    if (hasStructureChanged(oldData, newData)) {
                        // 1. Nhặt tất cả các file Đang up trên máy bạn ra
                        const pendingItems = oldData.filter(i => i.isPending);
                        
                        // 2. Chèn trả lại chúng vào danh sách mới tải về
                        newData = [...pendingItems, ...newData];
                        
                        // 3. Lưu & In ra màn hình (Giao diện lưới sẽ giữ nguyên 100% các hình đang up)
                        folderDataCache[currentFolderId] = newData;
                        localforage.setItem('vinhloc_folder_cache', folderDataCache).catch(()=>{});
                        currentDriveItems = newData;
                        window.renderItems(currentDriveItems); 
                    }
                }
            }

            // Tương tự cho màn hình trang chủ
            if (folderStack.length === 1 && typeof expandedMegas !== 'undefined' && expandedMegas.length > 0) {
                for (let megaId of expandedMegas) {
                    const subRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'list', folderId: megaId }) }).then(r => r.json());
                    if (subRes && subRes.success && subRes.data) {
                        let newSubData = subRes.data.filter(i => i.type === 'folder');
                        newSubData.forEach(item => { if (appMeta[item.id] && appMeta[item.id].name) item.name = appMeta[item.id].name; });
                        
                        const oldSubData = subFolderCache[megaId] || [];
                        if (hasStructureChanged(oldSubData, newSubData)) {
                            const pendingSub = oldSubData.filter(i => i.isPending);
                            newSubData = [...pendingSub, ...newSubData];
                            
                            subFolderCache[megaId] = newSubData;
                            localforage.setItem('vinhloc_subfolder_cache', subFolderCache).catch(()=>{});
                            if (typeof renderSubFolders === 'function') renderSubFolders(megaId, newSubData);
                            else if (window.renderSubFolders) window.renderSubFolders(megaId, newSubData);
                        }
                    }
                }
            }
        } catch(e) {}
    };

    window.masterSyncInterval = setInterval(window.masterSync, 6000);
    console.log("✅ Đã bật Đa Upload và Đóng Băng Giao Diện 100%");

}, 6000);
// ==============================================================
// PATCH 13: LÔI MENU TẢI ẢNH/LƯU DRIVE RA KHỎI LỚP BỊ CHE KHUẤT
// ==============================================================
setTimeout(() => {
    // 1. Sửa lỗi Modal bị che: Nâng Z-index của Modal xuất file lên mức tối đa
    const saveModal = document.getElementById('save-options-modal');
    if (saveModal) {
        saveModal.style.zIndex = '99999999'; // Lớp 8 số 9: Đè bẹp lớp 7 số 9 của giao diện Design!
    }

    // 2. Nâng luôn Z-index của khu vực thông báo (Toast) để thấy chữ "Đang xử lý..."
    const toastContainer = document.getElementById('toast-container');
    if (toastContainer) {
        toastContainer.style.zIndex = '999999999'; // Lớp 9 số 9: Cao nhất vũ trụ
    }

    // 3. Nâng Z-index của Modal nhập Text (khi chèn chữ vào ảnh) để không bị che
    const inputOverlay = document.getElementById('input-overlay');
    if (inputOverlay) {
        inputOverlay.style.zIndex = '99999999';
    }

    // 4. Tiện tay thêm tính năng: Bấm vào vùng tối xung quanh để đóng Menu Tải Xuống nhanh
    if (saveModal) {
        saveModal.addEventListener('click', (e) => {
            if (e.target === saveModal) { // Chỉ đóng khi bấm vào nền mờ
                saveModal.classList.add('hidden');
                saveModal.classList.remove('flex');
            }
        });
    }
    
    console.log("✅ Đã khôi phục hoàn hảo Menu xuất file trong Design!");
}, 2500); // Trễ 2.5s để đảm bảo mọi DOM đã load xong\
// ==============================================================
// PATCH 15: SỬA LỖI GOM CHUNG MEGA-ROW VÀ LỖI ẨN FOLDER CON
// ==============================================================

// 1. GHI ĐÈ HÀM KHỞI TẠO (TRỊ BỆNH GOM CHUNG MEGA-ROW LẦN ĐẦU MỞ APP)
async function initDatabase() {
    try {
        let storedMeta = await localforage.getItem('vinhloc_meta');
        appMeta = storedMeta || {};

        // [QUAN TRỌNG] NẾU APPMETA TRỐNG (MỞ LẦN ĐẦU), ÉP ĐỢI TẢI TỪ SHEETS XONG MỚI CHẠY TIẾP
        if (Object.keys(appMeta).length === 0) {
            console.log("Khởi động lần đầu: Đang tải dữ liệu phân loại từ Server...");
            const folderListEl = document.getElementById('folderList');
            if (folderListEl) {
                folderListEl.innerHTML = '<div class="text-center text-gray-500 mt-10 w-full"><div class="loader mx-auto mb-3 border-blue-400"></div>Đang thiết lập dữ liệu lần đầu...</div>';
            }
            try {
                // Tạm dừng mọi thứ để lấy Meta về
                const metaRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getMeta' }) }).then(r => r.json());
                if (metaRes && metaRes.success && metaRes.meta) {
                    appMeta = metaRes.meta;
                    await localforage.setItem('vinhloc_meta', appMeta);
                }
            } catch(e) { 
                console.warn("Lỗi mạng lần đầu tiên"); 
            }
        }

        // Khôi phục bộ đệm cấu trúc thư mục
        const storedFolderCache = await localforage.getItem('vinhloc_folder_cache');
        folderDataCache = storedFolderCache || {};
        
        const storedSubCache = await localforage.getItem('vinhloc_subfolder_cache');
        subFolderCache = storedSubCache || {};

        let metaCleaned = false;
        for (let id in appMeta) {
            if (appMeta[id].cover && appMeta[id].cover.length > 30000) {
                appMeta[id].cover = ''; metaCleaned = true;
            }
        }
        if (metaCleaned) await localforage.setItem('vinhloc_meta', appMeta);

        // Render ngay lập tức trang Triển khai (Lúc này đã có phân loại chuẩn 100%)
        const params = new URLSearchParams(window.location.search);
        if (!params.get('shareId')) {
            loadFolder(ROOT_FOLDER_ID, "Triển khai", false, false);
        }
    } catch (err) {
        console.error("Lỗi tải DB:", err);
    }
}

// 2. GHI ĐÈ HÀM VẼ GIAO DIỆN CHÍNH (TRỊ BỆNH ẨN FOLDER CON KHI CLICK VÀO TRONG)
setTimeout(() => {
    window.renderItems = function(items, isSearchMode = false) {
        // Đồng bộ chuẩn tên từ Sheets và dọn rác
        items.forEach(item => {
            item.description = ""; 
            if (appMeta[item.id] && appMeta[item.id].name) {
                item.name = appMeta[item.id].name; 
            }
        });

        const folderListEl = document.getElementById('folderList'); 
        const fileListEl = document.getElementById('fileList');
        folderListEl.innerHTML = ''; fileListEl.innerHTML = '';
        
        if (items.length === 0) { 
            folderListEl.innerHTML = '<div class="text-center text-gray-400 mt-8 w-full italic">Không có dữ liệu.</div>'; 
            return; 
        }

        // A. NẾU ĐANG Ở TRANG CHỦ (MEGA ROWS)
        if (folderStack.length === 1 && !isSearchMode) {
            const megaRows = items.filter(i => i.type === 'folder' && getMeta(i.id).type === currentCategory);
            if (megaRows.length === 0) { 
                folderListEl.innerHTML = `<div class="text-center text-gray-400 mt-8 w-full italic">Chưa có dữ liệu trong mục ${currentCategory}</div>`; 
                return; 
            }
            
            folderListEl.innerHTML = megaRows.map(item => {
                const meta = getMeta(item.id);
                // Thoát các dấu nháy đơn để chống vỡ mã HTML
                const safeName = item.name.replace(/'/g, "\\'"); 
                return `
                <div class="mega-row">
                    <div class="mega-header" onclick="window.toggleAccordion('${item.id}')">
                        <div class="flex items-center gap-3 overflow-hidden">
                            <i id="icon-${item.id}" class="fas fa-chevron-right text-gray-400 text-sm transition-transform duration-200 w-4 text-center"></i>
                            <div class="flex flex-col overflow-hidden">
                                <span class="truncate uppercase text-blue-800 item-name-${item.id}">${item.name}</span>
                                <span class="text-[11px] font-normal text-gray-500 truncate mt-1 item-desc-${item.id} ${meta.desc ? '' : 'hidden'}">${meta.desc || ''}</span>
                            </div>
                        </div>
                        <div class="relative flex-shrink-0" onclick="event.stopPropagation()">
                            <button onclick="window.toggleItemMenu('${item.id}', event)" class="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-blue-600 bg-gray-50 rounded-full transition"><i class="fas fa-ellipsis-v"></i></button>
                            <div id="menu-${item.id}" class="hidden absolute right-0 mt-2 w-44 bg-white rounded-2xl shadow-xl border border-gray-100 z-500 py-1.5 text-sm item-action-menu overflow-hidden">
                                <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition flex items-center" onclick="window.openInfo('${item.id}', '${safeName}', '${item.type}', 'mega', event)"><i class="fas fa-info-circle mr-3 text-blue-500 w-4"></i>Thông tin</div>
                                <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-green-600 font-semibold transition border-t border-gray-50 flex items-center" onclick="window.uiPromptFolder('${item.id}', event)"><i class="fas fa-folder-plus mr-3 w-4"></i>Thư mục</div>
                                <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition flex items-center" onclick="window.shareItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-share-nodes mr-3 text-green-500 w-4"></i>Chia sẻ</div>
                                <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition border-t border-gray-50 flex items-center" onclick="window.downloadItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-download mr-3 text-blue-500 w-4"></i>Tải xuống</div>
                                <div class="px-5 py-3 hover:bg-red-50 cursor-pointer text-red-600 font-semibold transition border-t border-gray-50 flex items-center" onclick="window.handleDelete('${item.id}', '${item.type}', event)"><i class="fas fa-trash mr-3 w-4"></i>Xóa</div>
                            </div>
                        </div>
                    </div>
                    <div id="acc-${item.id}" class="hidden bg-white border-t border-gray-100"></div>
                </div>`;
            }).join('');
            
            megaRows.forEach(row => { if(typeof expandedMegas !== 'undefined' && expandedMegas.includes(row.id)) window.toggleAccordion(row.id, true); });
        } 
        
        // B. NẾU ĐANG BÊN TRONG FOLDER HOẶC ĐANG TÌM KIẾM
        else {
            const folders = items.filter(i => i.type === 'folder'); 
            const files = items.filter(i => i.type !== 'folder');
            
            // XỬ LÝ VẼ FOLDER CON VÀ ÉP HIỂN THỊ CHỐNG ẨN
            if(folders.length > 0) {
                folderListEl.innerHTML = folders.map(item => {
                    const meta = getMeta(item.id); 
                    let isSelected = window.multiSelectState && window.multiSelectState.selectedIds.has(item.id);
                    const imgHtml = `<img src="${meta.cover || ''}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0 shadow-sm item-cover-img-${item.id} ${meta.cover ? '' : 'hidden'}"><div class="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 text-blue-500 text-xl item-cover-icon-${item.id} ${meta.cover ? 'hidden' : ''}"><i class="fas fa-folder"></i></div>`;
                    let checkUi = isSelected ? `<div class="absolute top-1/2 -translate-y-1/2 right-12 bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow"><i class="fas fa-check text-[10px]"></i></div>` : '';
                    let bgClass = isSelected ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50';
                    
                    const safeName = item.name.replace(/'/g, "\\'"); 

                    return `
                    <div class="subfolder-row group relative border-b transition ${bgClass}" style="display: flex !important;" onclick="loadFolder('${item.id}', '${safeName}', true)">
                        ${checkUi} ${imgHtml}
                        <div class="flex-1 overflow-hidden" onclick="window.toggleFileSelection ? window.toggleFileSelection('${item.id}', event) : null">
                            <h4 class="text-sm font-bold ${isSelected ? 'text-blue-800' : 'text-gray-800'} truncate item-name-${item.id}">${item.name}</h4>
                            <p class="text-[11px] text-gray-500 truncate mt-0.5 item-desc-${item.id} ${meta.desc ? '' : 'hidden'}">${meta.desc || 'Chưa có mô tả'}</p>
                        </div>
                        <div class="relative" onclick="event.stopPropagation()">
                            <button onclick="window.toggleItemMenu('${item.id}', event)" class="px-3 py-2 text-gray-400"><i class="fas fa-ellipsis-v"></i></button>
                            <div id="menu-${item.id}" class="hidden absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-lg border z-[500] py-1 text-sm item-action-menu">
                                <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer font-semibold text-gray-700 flex items-center" onclick="window.shareItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-share-nodes mr-3 text-green-500 w-4"></i>Chia sẻ</div>
                                <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer font-semibold text-gray-700 flex items-center" onclick="window.openInfo('${item.id}', '${safeName}', '${item.type}', 'sub', event)"><i class="fas fa-pen mr-3 text-blue-500 w-4"></i>Sửa</div>
                                <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer font-semibold text-gray-700 border-t flex items-center" onclick="window.downloadItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-download mr-3 text-blue-500 w-4"></i>Tải xuống</div>
                                <div class="px-4 py-3 hover:bg-red-50 text-red-600 cursor-pointer font-semibold border-t flex items-center" onclick="window.handleDelete('${item.id}', '${item.type}', event)"><i class="fas fa-trash mr-3 w-4"></i>Xóa</div>
                            </div>
                        </div>
                    </div>`;
                }).join('');
            }
            
            // XỬ LÝ VẼ FILE
            if (files.length > 0) {
                fileListEl.innerHTML = files.map(item => {
                    let isImage = item.mimeType.includes('image'); let isSelected = window.multiSelectState && window.multiSelectState.selectedIds.has(item.id);
                    let imgUrl = item.tempUrl ? item.tempUrl : `https://drive.google.com/thumbnail?id=${item.id}&sz=w400`; let fullImgUrl = item.tempUrl ? item.tempUrl : `https://drive.google.com/thumbnail?id=${item.id}&sz=w2000`;
                    let visualEl = isImage ? `<img src="${imgUrl}" data-url="${fullImgUrl}" class="w-full h-full object-cover drive-img-item" loading="lazy">` : `<div class="w-full h-full flex items-center justify-center bg-gray-50"><i class="fas fa-play-circle text-gray-400 text-4xl"></i></div>`;
                    let isTemp = item.tempUrl ? `<div class="absolute inset-0 bg-white/60 flex flex-col items-center justify-center backdrop-blur-[2px] z-10 rounded-2xl"><div class="loader mb-2 border-blue-600"></div><span class="text-[10px] font-bold text-blue-600">Đang Up...</span></div>` : '';
                    let checkUi = isSelected ? `<div class="absolute top-2 left-2 z-20 bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-md"><i class="fas fa-check text-xs"></i></div>` : '';
                    let borderClass = isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : 'border-gray-100 bg-white';
                    const safeName = item.name.replace(/'/g, "\\'"); 

                    return `
                    <div class="p-2.5 rounded-2xl shadow-sm border flex flex-col relative transition ${borderClass}">
                        ${checkUi} ${isTemp}
                        <div class="absolute top-2 right-2 z-20">
                            <button onclick="window.toggleItemMenu('${item.id}', event)" class="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-600 bg-white/90 backdrop-blur-md rounded-full shadow-sm"><i class="fas fa-ellipsis-v"></i></button>
                            <div id="menu-${item.id}" class="hidden absolute right-0 mt-1 w-40 bg-white rounded-2xl shadow-xl border border-gray-100 z-[500] py-1 text-sm item-action-menu overflow-hidden">
                                <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold flex items-center" onclick="window.shareItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-share-nodes mr-3 text-green-500 w-4"></i>Chia sẻ</div>
                                <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold flex items-center" onclick="window.downloadItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-download mr-3 text-blue-500 w-4"></i>Tải xuống</div>
                                <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold border-t flex items-center" onclick="window.openInfo('${item.id}', '${safeName}', '${item.type}', 'file', event)"><i class="fas fa-pen mr-3 text-blue-500 w-4"></i>Sửa</div>
                                <div class="px-4 py-3 hover:bg-red-50 cursor-pointer text-red-600 font-semibold border-t flex items-center" onclick="window.handleDelete('${item.id}', '${item.type}', event)"><i class="fas fa-trash mr-3 w-4"></i>Xóa</div>
                            </div>
                        </div>
                        <div class="w-full h-32 flex items-center justify-center bg-gray-100 rounded-xl overflow-hidden cursor-pointer mb-3" onclick="openMedia('${item.id}', '${item.mimeType}', '${safeName}', '${fullImgUrl}')">${visualEl}</div>
                        <div class="px-1 flex flex-col justify-center flex-1 cursor-pointer" onclick="window.toggleFileSelection ? window.toggleFileSelection('${item.id}', event) : null">
                            <span class="text-[13px] font-bold ${isSelected ? 'text-blue-700' : 'text-gray-800'} line-clamp-2 leading-tight drive-img-name item-name-${item.id}" title="${item.name}">${item.name}</span>
                            <span class="text-[10px] text-gray-400 mt-1 uppercase font-semibold">${item.mimeType.split('/')[1] || 'FILE'}</span>
                        </div>
                    </div>`;
                }).join('');
            }
        }
        
        // Quét lại một lượt để đảm bảo không sai màu
        smoothUpdateUI(appMeta);
    };

    // F5 nhẹ giao diện hiện tại để áp dụng ngay code sửa lỗi
    if (currentDriveItems && currentDriveItems.length > 0) {
        window.renderItems(currentDriveItems);
    }
}, 1000);
// ==============================================================
// PATCH 16: "CON NHỆN" CRAWLER - TẢI TRƯỚC TOÀN BỘ DỮ LIỆU NGẦM
// ==============================================================
setTimeout(() => {
    let isCrawling = false;
    
    window.backgroundPrefetch = async function() {
        // 1. Tạm dừng con Nhện nếu ứng dụng đang bận (Up file, Edit, hoặc MasterSync đang chạy)
        if (syncQueueCount > 0 || isCrawling || (window.lastEditTime && Date.now() - window.lastEditTime < 15000)) return;
        
        isCrawling = true;
        try {
            // 2. Mở "Sổ ghi chép" từ ổ cứng để biết tiến độ
            let queue = await localforage.getItem('vinhloc_crawl_queue') || [];
            let crawled = await localforage.getItem('vinhloc_crawled_set') || {};
            
            // 3. Nếu Sổ ghi chép trống (Đã tải xong toàn bộ công ty) -> Chờ 30 phút mới đi quét lại 1 vòng mới
            if (queue.length === 0) {
                const lastReset = await localforage.getItem('vinhloc_crawl_last_reset') || 0;
                if (Date.now() - lastReset > 1800000) { // 1800000ms = 30 phút
                    queue = [ROOT_FOLDER_ID];
                    crawled = {};
                    await localforage.setItem('vinhloc_crawl_last_reset', Date.now());
                } else {
                    isCrawling = false;
                    return; // Về ngủ tiếp, chưa tới giờ làm việc
                }
            }
            
            // 4. Lấy Thư mục đầu tiên trong hàng đợi ra để tải
            let targetId = queue.shift();
            
            // Nếu thư mục này đã tải rồi thì bỏ qua
            if (crawled[targetId]) {
                await localforage.setItem('vinhloc_crawl_queue', queue);
                isCrawling = false;
                return;
            }
            
            console.log("🕷️ Nhện đang tải ngầm thư mục:", targetId);
            
            // 5. Âm thầm kéo dữ liệu từ Google Drive
            const res = await fetch(SCRIPT_URL, { 
                method: 'POST', 
                body: JSON.stringify({ action: 'list', folderId: targetId }) 
            }).then(r => r.json());
            
            if (res && res.success && res.data) {
                let newData = res.data;
                
                // Đồng bộ Tên từ Sheets vào thẳng dữ liệu Drive
                newData.forEach(item => {
                    item.description = ""; 
                    if (appMeta[item.id] && appMeta[item.id].name) item.name = appMeta[item.id].name; 
                });
                
                // 6. Phân loại dữ liệu và cất vào Ổ cứng
                let isMegaRow = false;
                if (folderDataCache[ROOT_FOLDER_ID]) {
                    isMegaRow = folderDataCache[ROOT_FOLDER_ID].some(i => i.id === targetId);
                }
                
                if (targetId === ROOT_FOLDER_ID) {
                    // Nếu là gốc, chỉ nạp nếu chưa có (để không cãi nhau với MasterSync)
                    if (!folderDataCache[ROOT_FOLDER_ID]) folderDataCache[ROOT_FOLDER_ID] = newData;
                } else if (isMegaRow) {
                    subFolderCache[targetId] = newData; // Lưu vào ngăn chứa Mega-row
                } else {
                    folderDataCache[targetId] = newData; // Lưu vào ngăn Thư mục thường
                }
                
                // 7. Phát hiện các Thư mục con bên trong, ghi chú vào Sổ để lát tải tiếp
                const childFolders = newData.filter(i => i.type === 'folder');
                childFolders.forEach(child => {
                    if (!crawled[child.id] && !queue.includes(child.id)) {
                        queue.push(child.id); // Xếp hàng tải dần
                    }
                });
                
                // 8. Đóng mộc "Đã tải xong"
                crawled[targetId] = true;
                
                // 9. LƯU MỌI THỨ VÀO Ổ CỨNG VĨNH VIỄN
                await localforage.setItem('vinhloc_folder_cache', folderDataCache);
                await localforage.setItem('vinhloc_subfolder_cache', subFolderCache);
                await localforage.setItem('vinhloc_crawl_queue', queue);
                await localforage.setItem('vinhloc_crawled_set', crawled);
            }
        } catch (e) {
            console.warn("🕷️ Nhện rớt mạng, sẽ thử lại sau...");
        } finally {
            isCrawling = false;
        }
    };
    
    // KÍCH HOẠT NHỆN: Cứ 8 giây nó sẽ bò đi tải 1 thư mục!
    // (8 giây là tốc độ hoàn hảo: Đủ nhanh để nạp đầy DB, đủ chậm để Google không khóa API)
    window.spiderInterval = setInterval(window.backgroundPrefetch, 8000);
    console.log("✅ Con Nhện tải dữ liệu ngầm đã được thả!");

}, 7000); // Khởi động sau 7s khi các hệ thống khác đã yên vị
// ==============================================================
// PATCH 17: TÌM KIẾM SÂU ĐA LỚP REAL-TIME & CUỘN TẢI DẦN (LAZY LOAD)
// ==============================================================
setTimeout(() => {
    const searchInputEl = document.getElementById('searchInput');
    if (!searchInputEl) return;

    // Clone Input để hủy bỏ mọi sự kiện tìm kiếm cũ cồng kềnh
    const newSearchInput = searchInputEl.cloneNode(true);
    searchInputEl.parentNode.replaceChild(newSearchInput, searchInputEl);

    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const contentArea = document.getElementById('contentArea');

    // State quản lý Cuộn tải dần (Lazy Load)
    window.currentSearchResults = [];
    window.searchDisplayLimit = 30;
    window.isSearching = false;

    function removeAccents(str) { 
        if (!str) return ''; 
        return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); 
    }

    // Nút X xóa tìm kiếm
    clearSearchBtn.onclick = function() { 
        newSearchInput.value = ''; 
        this.classList.add('hidden'); 
        window.isSearching = false;
        window.currentSearchResults = [];
        window.renderItems(currentDriveItems); // Trở về danh sách gốc
    };

    // HÀM QUÉT RADAR: Lục tung toàn bộ Cache mà con Nhện đã tải
    function performDeepOfflineSearch(rawKeyword) {
        const kw = removeAccents(rawKeyword.trim());
        let localResults = new Map(); // Dùng Map để lọc trùng lặp ID

        const checkMatch = (item) => {
            if (!item || !item.name) return false;
            const itemName = removeAccents(item.name); 
            const itemMeta = appMeta[item.id] || {}; 
            const metaName = removeAccents(itemMeta.name || ''); 
            // So khớp cả Tên file thật và Tên do người dùng đặt lại
            return itemName.includes(kw) || metaName.includes(kw); 
        };

        // Quét sạch kho Cache cấu trúc thư mục (folderDataCache & subFolderCache)
        const allCaches = [folderDataCache, subFolderCache];
        allCaches.forEach(cacheObj => {
            Object.values(cacheObj).forEach(arr => {
                arr.forEach(item => {
                    if (checkMatch(item)) localResults.set(item.id, item);
                });
            });
        });

        // Quét thêm cả kho Meta (phòng khi thư mục chưa load nhưng Meta ảnh bìa đã load)
        Object.keys(appMeta).forEach(id => { 
            if (removeAccents(appMeta[id].name || '').includes(kw)) { 
                if (!localResults.has(id)) {
                    localResults.set(id, { id: id, name: appMeta[id].name, type: 'folder' }); 
                }
            } 
        });

        // Ưu tiên xếp Folder lên đầu, File xuống dưới
        let finalArray = Array.from(localResults.values());
        finalArray.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'folder' ? -1 : 1;
        });

        return finalArray;
    }

    let searchTimeout = null;

    newSearchInput.addEventListener('input', (e) => {
        const rawKeyword = e.target.value; 
        
        if (searchTimeout) clearTimeout(searchTimeout);
        
        // Nếu người dùng xóa trắng ô tìm kiếm
        if(!rawKeyword.trim()) { 
            clearSearchBtn.classList.add('hidden'); 
            window.isSearching = false;
            window.renderItems(currentDriveItems); 
            return; 
        }
        
        clearSearchBtn.classList.remove('hidden');
        window.isSearching = true;

        // Trễ 250ms để gõ phím trên điện thoại không bị lag
        searchTimeout = setTimeout(async () => {
            const folderListEl = document.getElementById('folderList'); 
            const fileListEl = document.getElementById('fileList');
            
            // Hiển thị loading nhẹ
            folderListEl.innerHTML = '<div class="text-center mt-8"><div class="loader mx-auto border-blue-400 mb-2"></div><p class="text-sm text-gray-500 font-semibold">Đang truy quét...</p></div>'; 
            fileListEl.innerHTML = '';

            // 1. TÌM KIẾM SIÊU TỐC TRONG RAM & Ổ CỨNG (0 giây)
            let resultsArray = performDeepOfflineSearch(rawKeyword);
            
            // Lưu lại kết quả để phục vụ tính năng lướt (Lazy Load)
            window.currentSearchResults = resultsArray;
            window.searchDisplayLimit = 30; // Trả về 30 item đầu tiên

            if (resultsArray.length > 0) {
                // isSearchMode = true (Tham số thứ 2) sẽ tự động phá vỡ vách ngăn Triển khai/Ý tưởng
                window.renderItems(resultsArray.slice(0, window.searchDisplayLimit), true);
            } else {
                folderListEl.innerHTML = '<div class="text-center text-gray-400 mt-8 w-full italic">Đang tìm sâu trên Drive mây...</div>';
            }

            // 2. GỌI API MÂY TÌM KẾM BỔ SUNG (Vét cạn những gì Nhện chưa tải kịp)
            try {
                const res = await apiCall('globalSearch', { keyword: rawKeyword.trim() });
                if (res && res.success && res.data) {
                    let hasNew = false;
                    res.data.forEach(item => { 
                        // Bổ sung các kết quả mới từ Mây vào danh sách nội bộ
                        if (!window.currentSearchResults.find(i => i.id === item.id)) {
                            window.currentSearchResults.push(item);
                            hasNew = true;
                        }
                    });
                    
                    // Nếu Mây có trả về thêm đồ mới, Cập nhật lại giao diện ngay!
                    if (hasNew || resultsArray.length === 0) {
                        if (window.currentSearchResults.length > 0) {
                            window.renderItems(window.currentSearchResults.slice(0, window.searchDisplayLimit), true);
                        } else {
                            folderListEl.innerHTML = `<div class="text-center text-gray-400 mt-8 w-full italic">Không tìm thấy kết quả nào chứa "${rawKeyword}".</div>`;
                        }
                    }
                }
            } catch(err) {} // Lỗi mạng thì cứ xài kết quả offline như bình thường

        }, 250); 
    });

    // SỰ KIỆN LƯỚT CHUỘT / VUỐT ĐIỆN THOẠI ĐỂ TẢI DẦN (INFINITE SCROLL)
    contentArea.addEventListener('scroll', function() {
        // Chỉ kích hoạt khi đang ở chế độ Tìm kiếm
        if (window.isSearching && window.currentSearchResults.length > 0) {
            
            // Kiểm tra xem đã lướt tới gần đáy chưa (cách đáy 150px)
            if (this.scrollTop + this.clientHeight >= this.scrollHeight - 150) {
                
                // Nếu số lượng hiển thị hiện tại vẫn còn nhỏ hơn tổng số tìm được
                if (window.searchDisplayLimit < window.currentSearchResults.length) {
                    
                    // Mở khóa thêm 30 kết quả nữa
                    window.searchDisplayLimit += 30; 
                    
                    // Vẽ lại cực êm (RenderItems đè HTML cục bộ rất nhẹ)
                    window.renderItems(window.currentSearchResults.slice(0, window.searchDisplayLimit), true);
                }
            }
        }
    });

    console.log("✅ Đã nâng cấp Tìm kiếm Sâu Đa lớp & Cuộn tải dần (Lazy Load)!");
}, 7500); // Đợi các patch nền móng hoàn tất trước
// ==============================================================
// PATCH 18: FIX ĐƠ APP, TRẢ LẠI TỐC ĐỘ TÌM KIẾM SIÊU TỐC
// ==============================================================
setTimeout(() => {
    // ---------------------------------------------------------
    // 1. CHẶN ĐỨNG NGUYÊN NHÂN GÂY ĐƠ (TỐI ƯU CẬP NHẬT GIAO DIỆN)
    // ---------------------------------------------------------
    window.smoothUpdateUI = function(newMeta) {
        // Bí quyết chống đơ: Chỉ cập nhật những ID ĐANG HIỂN THỊ trên màn hình!
        let visibleIds = new Set();
        if (currentDriveItems) currentDriveItems.forEach(i => visibleIds.add(i.id));
        
        if (folderStack.length === 1) {
            if (folderDataCache[ROOT_FOLDER_ID]) folderDataCache[ROOT_FOLDER_ID].forEach(i => visibleIds.add(i.id));
            if (typeof expandedMegas !== 'undefined') {
                expandedMegas.forEach(megaId => {
                    if (subFolderCache[megaId]) subFolderCache[megaId].forEach(i => visibleIds.add(i.id));
                });
            }
        }

        visibleIds.forEach(id => {
            const meta = newMeta[id];
            if (!meta) return;
            
            document.querySelectorAll(`.item-name-${id}`).forEach(el => {
                if (meta.name && el.textContent !== meta.name) { el.textContent = meta.name; el.title = meta.name; }
            });
            document.querySelectorAll(`.item-desc-${id}`).forEach(el => {
                const newDesc = meta.desc || 'Chưa có mô tả';
                if (el.textContent !== newDesc) el.textContent = newDesc;
                if(meta.desc) el.classList.remove('hidden'); else el.classList.add('hidden');
            });
            document.querySelectorAll(`.item-cover-img-${id}`).forEach(img => {
                const icon = document.querySelector(`.item-cover-icon-${id}`);
                if (meta.cover) {
                    if(img.src !== meta.cover) img.src = meta.cover;
                    img.classList.remove('hidden'); if(icon) icon.classList.add('hidden');
                } else {
                    img.classList.add('hidden'); if(icon) icon.classList.remove('hidden');
                }
            });

            if (folderStack.length === 1) {
                const headerIcon = document.getElementById(`icon-${id}`);
                if (headerIcon) {
                    const row = headerIcon.closest('.mega-row');
                    if (row) row.style.display = (meta.type !== currentCategory) ? 'none' : 'block';
                }
            }
        });
    };

    // Khử hàm smoothUpdateUI dư thừa lúc render bị gọi sai
    const originalRenderItems = window.renderItems;
    window.renderItems = function(items, isSearchMode = false) {
        // Ghi đè hàm rỗng để chặn renderItems gọi smoothUpdateUI gây đơ
        const tempSmooth = window.smoothUpdateUI;
        window.smoothUpdateUI = function(){}; 
        
        originalRenderItems(items, isSearchMode);
        
        // Trả lại hàm sau khi render xong
        window.smoothUpdateUI = tempSmooth; 
    };

    // ---------------------------------------------------------
    // 2. PHỤC SINH THANH TÌM KIẾM (TẮT CLOUD, 100% OFFLINE NHỆN)
    // ---------------------------------------------------------
    const searchInputEl = document.getElementById('searchInput');
    if (!searchInputEl) return;

    // Thay ruột thanh tìm kiếm
    const newSearchInput = searchInputEl.cloneNode(true);
    searchInputEl.parentNode.replaceChild(newSearchInput, searchInputEl);

    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const contentArea = document.getElementById('contentArea');

    window.currentSearchResults = [];
    window.searchDisplayLimit = 30;
    window.isSearching = false;

    function removeAccents(str) { 
        if (!str) return ''; 
        return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); 
    }

    clearSearchBtn.onclick = function() { 
        newSearchInput.value = ''; 
        this.classList.add('hidden'); 
        window.isSearching = false;
        window.currentSearchResults = [];
        window.renderItems(currentDriveItems); 
    };

    function performDeepOfflineSearch(rawKeyword) {
        const kw = removeAccents(rawKeyword.trim());
        let localResults = new Map(); 

        const checkMatch = (item) => {
            if (!item || !item.name) return false;
            const itemName = removeAccents(String(item.name)); 
            const itemMeta = appMeta[item.id] || {}; 
            const metaName = removeAccents(String(itemMeta.name || '')); 
            return itemName.includes(kw) || metaName.includes(kw); 
        };

        const allCaches = [folderDataCache, subFolderCache];
        allCaches.forEach(cacheObj => {
            Object.values(cacheObj).forEach(arr => {
                if(Array.isArray(arr)) {
                    arr.forEach(item => {
                        if (checkMatch(item)) localResults.set(item.id, item);
                    });
                }
            });
        });

        Object.keys(appMeta).forEach(id => { 
            if (removeAccents(String(appMeta[id].name || '')).includes(kw)) { 
                if (!localResults.has(id)) {
                    localResults.set(id, { id: id, name: appMeta[id].name, type: 'folder' }); 
                }
            } 
        });

        let finalArray = Array.from(localResults.values());
        finalArray.sort((a, b) => {
            if (a.type === b.type) return String(a.name).localeCompare(String(b.name));
            return a.type === 'folder' ? -1 : 1;
        });

        return finalArray;
    }

    let searchTimeout = null;

    newSearchInput.addEventListener('input', (e) => {
        const rawKeyword = e.target.value; 
        if (searchTimeout) clearTimeout(searchTimeout);
        
        if(!rawKeyword.trim()) { 
            clearSearchBtn.classList.add('hidden'); 
            window.isSearching = false;
            window.renderItems(currentDriveItems); 
            return; 
        }
        
        clearSearchBtn.classList.remove('hidden');
        window.isSearching = true;

        searchTimeout = setTimeout(() => {
            const folderListEl = document.getElementById('folderList'); 
            const fileListEl = document.getElementById('fileList');
            
            folderListEl.innerHTML = '<div class="text-center mt-8"><div class="loader mx-auto border-blue-400 mb-2"></div><p class="text-sm text-gray-500 font-semibold">Đang truy quét...</p></div>'; 
            fileListEl.innerHTML = '';

            // TÌM KIẾM 100% OFFLINE - KHÔNG DÙNG CLOUD NỮA ĐỂ CHỐNG ĐƠ
            let resultsArray = performDeepOfflineSearch(rawKeyword);
            window.currentSearchResults = resultsArray;
            window.searchDisplayLimit = 30; 

            if (resultsArray.length > 0) {
                window.renderItems(resultsArray.slice(0, window.searchDisplayLimit), true);
            } else {
                folderListEl.innerHTML = `<div class="text-center text-gray-400 mt-8 w-full italic">Không tìm thấy kết quả nào chứa "${rawKeyword}".</div>`;
            }
        }, 300); // Đợi gõ xong 300ms mới quét để mượt
    });

    // ---------------------------------------------------------
    // 3. CUỘN TẢI DẦN (LAZY LOAD) CHỐNG LAG KHI KẾT QUẢ QUÁ NHIỀU
    // ---------------------------------------------------------
    const handleScroll = function() {
        if (window.isSearching && window.currentSearchResults.length > 0) {
            // Cuộn gần tới đáy thì nhả thêm 30 kết quả
            if (this.scrollTop + this.clientHeight >= this.scrollHeight - 250) {
                if (window.searchDisplayLimit < window.currentSearchResults.length) {
                    window.searchDisplayLimit += 30; 
                    window.renderItems(window.currentSearchResults.slice(0, window.searchDisplayLimit), true);
                }
            }
        }
    };
    
    contentArea.removeEventListener('scroll', window.lastScrollHandler);
    contentArea.addEventListener('scroll', handleScroll);
    window.lastScrollHandler = handleScroll;

    console.log("✅ PATCH 18: Đã hồi sinh Thanh Tìm Kiếm siêu tốc độ!");
}, 8500); // Khởi chạy trễ nhất để đè bẹp các lỗi cũ
// ==============================================================
// PATCH 19: FIX GIẬT LAG NÚT BACK & CHỐNG CHỚP GIAO DIỆN (RACE CONDITION)
// ==============================================================
setTimeout(() => {

    // 1. SỬA HÀM LOAD FOLDER: LOẠI BỎ LOADING THỪA KHI BẤM BACK
    window.loadFolder = async function (folderId, folderName, isNewNavigation = false, isPopState = false) {
        // Hỗ trợ thoát giao diện Design bằng nút Back
        if (window.isDesignOverlayActive && isPopState) { 
            window.isDesignOverlayActive = false; 
            const overlayContainer = document.getElementById('watermark-overlay-container'); 
            if (overlayContainer) overlayContainer.style.display = 'none'; 
            return; 
        }

        if (isNewNavigation && !isPopState) {
            if (folderStack.length > 0) folderStack[folderStack.length - 1].scrollTop = document.getElementById('contentArea').scrollTop;
        }
        
        currentFolderId = folderId; // Đánh dấu vị trí hiện tại ngay lập tức
        
        if (isNewNavigation && !isPopState) {
            const existingIdx = folderStack.findIndex(f => f.id === folderId);
            if (existingIdx !== -1) folderStack = folderStack.slice(0, existingIdx + 1);
            else folderStack.push({ id: folderId, name: folderName, scrollTop: 0 });
            localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
            history.pushState({ id: folderId }, '', '');
        }
        
        updateBreadcrumbs();
        if (document.getElementById('searchInput')) document.getElementById('searchInput').value = '';
        if (document.getElementById('clearSearchBtn')) document.getElementById('clearSearchBtn').classList.add('hidden');

        const restoreScroll = () => {
            const targetStackItem = folderStack[folderStack.length - 1];
            if (targetStackItem && targetStackItem.scrollTop) {
                setTimeout(() => { document.getElementById('contentArea').scrollTop = targetStackItem.scrollTop; }, 10);
            } else { document.getElementById('contentArea').scrollTop = 0; }
        };

        // BÍ QUYẾT MƯỢT MÀ TẠI ĐÂY:
        if (folderDataCache[folderId]) {
            // A. Đã có Cache -> BUNG RA NGAY TỨC THÌ, KHÔNG HIỆN LOADING
            currentDriveItems = folderDataCache[folderId];
            window.renderItems(currentDriveItems);
            restoreScroll();

            // B. Chỉ gọi API ngầm (Tắt 100% các vòng xoay loading cản trở UI)
            fetch(SCRIPT_URL, { 
                method: 'POST', 
                body: JSON.stringify({ action: 'list', folderId: folderId }) 
            }).then(r => r.json()).then(res => {
                // BẢO VỆ GIAO DIỆN: Chỉ cập nhật nếu người dùng VẪN ĐANG Ở thư mục này
                if (res && res.success && currentFolderId === folderId) { 
                    let newData = res.data;
                    newData.forEach(item => { if (appMeta[item.id] && appMeta[item.id].name) item.name = appMeta[item.id].name; });
                    
                    const oldData = folderDataCache[folderId] || [];
                    const oldIds = oldData.filter(i => !i.isPending).map(i => i.id).sort().join(',');
                    const newIds = newData.filter(i => !i.isPending).map(i => i.id).sort().join(',');
                    
                    if (oldIds !== newIds) {
                        const pendingItems = oldData.filter(i => i.isPending);
                        newData = [...pendingItems, ...newData];
                        
                        folderDataCache[folderId] = newData;
                        localforage.setItem('vinhloc_folder_cache', folderDataCache).catch(()=>{});
                        currentDriveItems = newData;
                        
                        const currentScroll = document.getElementById('contentArea').scrollTop;
                        window.renderItems(currentDriveItems);
                        document.getElementById('contentArea').scrollTop = currentScroll;
                    }
                }
            }).catch(e => {});

        } else {
            // THƯ MỤC MỚI TINH CHƯA TỪNG MỞ -> LÚC NÀY MỚI CẦN HIỆN LOADING
            const folderListEl = document.getElementById('folderList');
            const fileListEl = document.getElementById('fileList');
            folderListEl.innerHTML = '<div class="text-center text-gray-500 mt-10 w-full"><div class="loader mx-auto mb-3 border-blue-400"></div>Đang tải dữ liệu...</div>';
            fileListEl.innerHTML = '';
            
            const res = await apiCall('list', { folderId: folderId });
            if (res && res.success) {
                // CHỐNG CHỚP: Chỉ hiển thị nếu người dùng chưa chuyển đi thư mục khác
                if (currentFolderId === folderId) {
                    let newData = res.data;
                    newData.forEach(item => { if (appMeta[item.id] && appMeta[item.id].name) item.name = appMeta[item.id].name; });
                    currentDriveItems = newData; 
                    folderDataCache[folderId] = newData;
                    window.renderItems(currentDriveItems); 
                    restoreScroll();
                }
            } else { 
                if (currentFolderId === folderId) {
                    folderListEl.innerHTML = '<div class="text-center text-gray-500 mt-10 w-full italic">Lỗi kết nối hoặc thư mục trống.</div>'; 
                }
            }
        }
    };

    // 2. SỬA LẠI CỖ MÁY MASTER SYNC: TRÁNH ĐỤNG ĐỘ KHI NGƯỜI DÙNG CHUYỂN TRANG
    if (window.masterSyncInterval) clearInterval(window.masterSyncInterval);

    window.masterSync = async function() {
        if (syncQueueCount > 0 || (window.lastEditTime && Date.now() - window.lastEditTime < 15000)) return;
        if (document.querySelector('.item-action-menu:not(.hidden)') || !document.getElementById('customModal').classList.contains('hidden') || !document.getElementById('infoModal').classList.contains('hidden')) return;

        // BẮT CỐC VỊ TRÍ HIỆN TẠI (GPS CỦA NGƯỜI DÙNG)
        const syncTargetId = currentFolderId; 

        try {
            const metaRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getMeta' }) }).then(r => r.json());
            if (metaRes && metaRes.success && metaRes.meta) {
                if (JSON.stringify(appMeta) !== JSON.stringify(metaRes.meta)) {
                    appMeta = metaRes.meta; 
                    localforage.setItem('vinhloc_meta', appMeta).catch(()=>{});
                    smoothUpdateUI(appMeta); 
                }
            }

            const hasStructureChanged = (oldArr, newArr) => {
                const oldIds = oldArr.filter(i => !i.isPending).map(i => i.id).sort().join(',');
                const newIds = newArr.filter(i => !i.isPending).map(i => i.id).sort().join(',');
                return oldIds !== newIds; 
            };

            if (syncTargetId && syncTargetId !== 'dummy_design_state') {
                const listRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'list', folderId: syncTargetId }) }).then(r => r.json());
                
                // LÁ CHẮN CHỐNG CHỚP GIAO DIỆN:
                // Nếu tải xong mà thấy người dùng đã đi chỗ khác (currentFolderId đổi) -> Dừng ngay lập tức!
                if (currentFolderId !== syncTargetId) return;

                if (listRes && listRes.success && listRes.data) {
                    let newData = listRes.data;
                    newData.forEach(item => { if (appMeta[item.id] && appMeta[item.id].name) item.name = appMeta[item.id].name; });
                    
                    const oldData = folderDataCache[syncTargetId] || [];
                    
                    if (hasStructureChanged(oldData, newData)) {
                        const pendingItems = oldData.filter(i => i.isPending);
                        newData = [...pendingItems, ...newData];
                        
                        folderDataCache[syncTargetId] = newData;
                        localforage.setItem('vinhloc_folder_cache', folderDataCache).catch(()=>{});
                        currentDriveItems = newData;
                        window.renderItems(currentDriveItems); 
                    }
                }
            }

            // Xử lý nốt các Mega-row đang được mở ở trang chủ
            if (folderStack.length === 1 && typeof expandedMegas !== 'undefined' && expandedMegas.length > 0) {
                for (let megaId of expandedMegas) {
                    const currentHomeTargetId = currentFolderId;
                    const subRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'list', folderId: megaId }) }).then(r => r.json());
                    
                    // Nếu đang load mà người dùng bấm qua trang khác -> Dừng lại ngay
                    if (currentFolderId !== currentHomeTargetId) continue; 

                    if (subRes && subRes.success && subRes.data) {
                        let newSubData = subRes.data.filter(i => i.type === 'folder');
                        newSubData.forEach(item => { if (appMeta[item.id] && appMeta[item.id].name) item.name = appMeta[item.id].name; });
                        
                        const oldSubData = subFolderCache[megaId] || [];
                        if (hasStructureChanged(oldSubData, newSubData)) {
                            const pendingSub = oldSubData.filter(i => i.isPending);
                            newSubData = [...pendingSub, ...newSubData];
                            
                            subFolderCache[megaId] = newSubData;
                            localforage.setItem('vinhloc_subfolder_cache', subFolderCache).catch(()=>{});
                            if (typeof renderSubFolders === 'function') renderSubFolders(megaId, newSubData);
                            else if (window.renderSubFolders) window.renderSubFolders(megaId, newSubData);
                        }
                    }
                }
            }
        } catch(e) {}
    };

    window.masterSyncInterval = setInterval(window.masterSync, 6000);
    console.log("✅ PATCH 19: Đã gắn định vị cho Cỗ máy, sửa dứt điểm lỗi giật chớp!");

}, 9000);
// ==============================================================
// PATCH 20: FIX TÌM KIẾM (DIỆT ZOMBIE & PHỤC HỒI ĐƯỜNG DẪN GỐC)
// ==============================================================
setTimeout(() => {
    // 1. TẠO HÀM DỌN RÁC TOÀN CỤC (GLOBAL PURGE)
    window.purgeDeletedItem = function(id) {
        currentDriveItems = currentDriveItems.filter(i => i.id !== id);
        for (let fId in folderDataCache) { folderDataCache[fId] = folderDataCache[fId].filter(i => i.id !== id); }
        localforage.setItem('vinhloc_folder_cache', folderDataCache).catch(()=>{});
        for (let mId in subFolderCache) { subFolderCache[mId] = subFolderCache[mId].filter(i => i.id !== id); }
        localforage.setItem('vinhloc_subfolder_cache', subFolderCache).catch(()=>{});
        if (appMeta[id]) { delete appMeta[id]; localforage.setItem('vinhloc_meta', appMeta).catch(()=>{}); }
    };

    // 2. GHI ĐÈ HÀM XÓA (Gắn thêm Cỗ máy thanh trừng)
    const originalHandleDelete = window.handleDelete;
    window.handleDelete = function(id, type, e) {
        if(originalHandleDelete) originalHandleDelete(id, type, e); 
        const btn = document.getElementById('modalConfirmBtn');
        if(btn) {
            const originalOnClick = btn.onclick; 
            btn.onclick = () => {
                if (originalOnClick) originalOnClick(); 
                window.purgeDeletedItem(id); 
                if (window.isSearching) {
                    window.currentSearchResults = window.currentSearchResults.filter(i => i.id !== id);
                    window.renderItems(window.currentSearchResults.slice(0, window.searchDisplayLimit), true);
                }
            };
        }
    };

    const originalDeleteSelected = window.deleteSelectedItems;
    window.deleteSelectedItems = function() {
        if(originalDeleteSelected) originalDeleteSelected();
        const btn = document.getElementById('modalConfirmBtn');
        if(btn) {
            const originalOnClick = btn.onclick;
            btn.onclick = async () => {
                let idsToDelete = Array.from(window.multiSelectState.selectedIds);
                if (originalOnClick) await originalOnClick(); 
                idsToDelete.forEach(id => window.purgeDeletedItem(id));
                if (window.isSearching) {
                    window.currentSearchResults = window.currentSearchResults.filter(i => !idsToDelete.includes(i.id));
                    window.renderItems(window.currentSearchResults.slice(0, window.searchDisplayLimit), true);
                }
            };
        }
    };

    // 3. HÀM TÌM KIẾM OFFLINE SẠCH (KHÔNG TÌM ZOMBIE)
    function removeAccents(str) { return str ? String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : ''; }

    window.performDeepOfflineSearch = function(rawKeyword) {
        const kw = removeAccents(rawKeyword.trim());
        let localResults = new Map(); 
        const checkMatch = (item) => {
            if (!item || !item.name) return false;
            const itemName = removeAccents(String(item.name)); 
            const itemMeta = appMeta[item.id] || {}; 
            const metaName = removeAccents(String(itemMeta.name || '')); 
            return itemName.includes(kw) || metaName.includes(kw); 
        };

        const allCaches = [folderDataCache, subFolderCache];
        allCaches.forEach(cacheObj => {
            Object.values(cacheObj).forEach(arr => {
                if(Array.isArray(arr)) { arr.forEach(item => { if (checkMatch(item)) localResults.set(item.id, item); }); }
            });
        });

        let finalArray = Array.from(localResults.values());
        finalArray.sort((a, b) => {
            if (a.type === b.type) return String(a.name).localeCompare(String(b.name));
            return a.type === 'folder' ? -1 : 1;
        });
        return finalArray;
    };

    // 4. [TÍNH NĂNG MỚI] - XÂY DỰNG LẠI ĐƯỜNG DẪN KHI MỞ TỪ TÌM KIẾM
    window.openSearchResult = function(id, name, type, mimeType, fullImgUrl) {
        let parentId = null; let grandparent = null; let isMega = false;
        if (folderDataCache[ROOT_FOLDER_ID]) isMega = folderDataCache[ROOT_FOLDER_ID].some(i => i.id === id);

        if (!isMega) {
            for (let mId in subFolderCache) { if (subFolderCache[mId] && subFolderCache[mId].some(i => i.id === id)) { parentId = mId; break; } }
            if (!parentId) {
                for (let fId in folderDataCache) { if (fId !== ROOT_FOLDER_ID && folderDataCache[fId] && folderDataCache[fId].some(i => i.id === id)) { parentId = fId; break; } }
            }
            if (parentId) {
                for (let mId in subFolderCache) { if (subFolderCache[mId] && subFolderCache[mId].some(i => i.id === parentId)) { grandparent = mId; break; } }
            }
        }

        let cat = appMeta[id]?.type || appMeta[parentId]?.type || appMeta[grandparent]?.type || window.currentCategory || "Triển khai";
        let newStack = [{ id: ROOT_FOLDER_ID, name: cat, scrollTop: 0 }];

        if (type === 'folder') {
            if (grandparent) {
                newStack.push({ id: grandparent, name: appMeta[grandparent]?.name || '...', scrollTop: 0 });
                newStack.push({ id: parentId, name: appMeta[parentId]?.name || '...', scrollTop: 0 });
            } else if (parentId) {
                newStack.push({ id: parentId, name: appMeta[parentId]?.name || '...', scrollTop: 0 });
            }
            
            folderStack = newStack;
            localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
            
            document.getElementById('searchInput').value = '';
            if(document.getElementById('clearSearchBtn')) document.getElementById('clearSearchBtn').classList.add('hidden');
            window.isSearching = false;
            
            loadFolder(id, name, true); // Mở folder
        } else {
            // LÀ FILE: Nạp thư mục cha chứa file đó, rồi mở ảnh full lên
            if (grandparent) newStack.push({ id: grandparent, name: appMeta[grandparent]?.name || '...', scrollTop: 0 });
            if (parentId) {
                newStack.push({ id: parentId, name: appMeta[parentId]?.name || '...', scrollTop: 0 });
                folderStack = newStack;
                localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
                
                document.getElementById('searchInput').value = '';
                if(document.getElementById('clearSearchBtn')) document.getElementById('clearSearchBtn').classList.add('hidden');
                window.isSearching = false;
                
                let loadPromise = loadFolder(parentId, appMeta[parentId]?.name || '...', true);
                if (loadPromise && loadPromise.then) {
                    loadPromise.then(() => openMedia(id, mimeType, name, fullImgUrl));
                } else {
                    setTimeout(() => openMedia(id, mimeType, name, fullImgUrl), 400);
                }
            } else {
                openMedia(id, mimeType, name, fullImgUrl);
            }
        }
    };

    // 5. GẮN LẠI SỰ KIỆN TÌM KIẾM
    const searchInputEl = document.getElementById('searchInput');
    if (searchInputEl) {
        const newSearchInput = searchInputEl.cloneNode(true);
        searchInputEl.parentNode.replaceChild(newSearchInput, searchInputEl);
        let searchTimeout = null;
        newSearchInput.addEventListener('input', (e) => {
            const rawKeyword = e.target.value; 
            if (searchTimeout) clearTimeout(searchTimeout);
            if(!rawKeyword.trim()) { 
                document.getElementById('clearSearchBtn').classList.add('hidden'); 
                window.isSearching = false; window.renderItems(currentDriveItems); return; 
            }
            document.getElementById('clearSearchBtn').classList.remove('hidden'); window.isSearching = true;

            searchTimeout = setTimeout(() => {
                const folderListEl = document.getElementById('folderList'); const fileListEl = document.getElementById('fileList');
                folderListEl.innerHTML = '<div class="text-center mt-8"><div class="loader mx-auto border-blue-400 mb-2"></div><p class="text-sm text-gray-500 font-semibold">Đang truy quét...</p></div>'; 
                fileListEl.innerHTML = '';
                let resultsArray = window.performDeepOfflineSearch(rawKeyword);
                window.currentSearchResults = resultsArray; window.searchDisplayLimit = 30; 
                if (resultsArray.length > 0) window.renderItems(resultsArray.slice(0, window.searchDisplayLimit), true);
                else folderListEl.innerHTML = `<div class="text-center text-gray-400 mt-8 w-full italic">Không tìm thấy kết quả nào chứa "${rawKeyword}".</div>`;
            }, 300); 
        });

        document.getElementById('clearSearchBtn').onclick = function() { 
            newSearchInput.value = ''; this.classList.add('hidden'); 
            window.isSearching = false; window.currentSearchResults = []; window.renderItems(currentDriveItems); 
        };
    }
    console.log("✅ PATCH 20: Đã cập nhật Đường dẫn gốc & Diệt Zombie!");
}, 9500);
// ==============================================================
// PATCH 21: ĐẢO NGƯỢC LOGIC CLICK & NÚT BACK (SAFE MODE BẤT TỬ V2)
// ==============================================================
setTimeout(() => {
    // 1. CHẶN NÚT BACK CHO GIAO DIỆN XEM ẢNH/VIDEO (SỬA LỖI TẬN GỐC)
    if (!window.isMediaBackHandled) {
        window.isMediaBackHandled = true;
        window.ignoreNextPopState = false; 
        
        const originalOpenMedia = window.openMedia;
        window.openMedia = function(id, mimeType, name, url) {
            // Gọi hàm mở gốc để hiện UI
            if (originalOpenMedia) originalOpenMedia(id, mimeType, name, url);
            
            window.isMediaViewerActive = true;
            
            // 1. Đẩy 1 trang ảo vào lịch sử trình duyệt
            history.pushState({ mediaViewer: true }, '', ''); 
            
            // 2. Đẩy 1 thư mục ảo vào folderStack để làm "bia đỡ đạn" cho hàm popstate gốc
            if (typeof folderStack !== 'undefined' && folderStack.length > 0) {
                const currentFolder = folderStack[folderStack.length - 1];
                folderStack.push({ ...currentFolder, isMediaDummy: true });
                localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
            }
        };

        const originalCloseMedia = window.closeMedia;
        window.closeMedia = function() {
            // Tắt UI chính xác bằng ID mediaViewer
            const viewer = document.getElementById('mediaViewer');
            if (viewer) { viewer.classList.add('hidden'); viewer.classList.remove('flex'); }
            const content = document.getElementById('mediaContent');
            if (content) content.innerHTML = '';
            
            // Nếu đang đóng bằng nút X trên màn hình
            if (window.isMediaViewerActive) {
                window.isMediaViewerActive = false;
                window.ignoreNextPopState = true; // Kích hoạt khiên chặn popstate tiếp theo
                history.back(); // Tự động lùi lịch sử để nuốt trang ảo
            }
        };

        // Bọc hàm loadFolder để bắt tín hiệu lùi trang từ popstate gốc
        const cachedLoadFolder = window.loadFolder;
        if (cachedLoadFolder) {
            window.loadFolder = async function(folderId, folderName, isNewNavigation = false, isPopState = false) {
                // TH1: Do nút X gọi history.back() gây ra
                if (isPopState && window.ignoreNextPopState) {
                    window.ignoreNextPopState = false; 
                    return; // Chặn không cho tải lại thư mục, đứng im tại chỗ
                }
                
                // TH2: Do người dùng bấm phím Back vật lý trên điện thoại
                if (isPopState && window.isMediaViewerActive) {
                    window.isMediaViewerActive = false;
                    
                    // Tắt UI
                    const viewer = document.getElementById('mediaViewer');
                    if (viewer) { viewer.classList.add('hidden'); viewer.classList.remove('flex'); }
                    const content = document.getElementById('mediaContent');
                    if (content) content.innerHTML = '';
                    
                    return; // Chặn không cho lùi thư mục, đứng im tại chỗ
                }
                
                // Nếu không vướng 2 cái trên, thì tải thư mục bình thường
                return cachedLoadFolder(folderId, folderName, isNewNavigation, isPopState);
            };
        }
    }

    // 2. GHI ĐÈ HÀM RENDER ITEMS (ĐẢO NGƯỢC LOGIC CLICK + SAFE MODE)
    window.renderItems = function (items, isSearchMode = false) {
        const tempSmooth = window.smoothUpdateUI; 
        window.smoothUpdateUI = function(){};
        
        try {
            let metaChanged = false;
            items.forEach(item => {
                if (item.type === 'folder') {
                    if (!appMeta[item.id]) { appMeta[item.id] = { type: 'Triển khai', desc: '', cover: '' }; metaChanged = true; }
                    let descStr = item.description || "";
                    if (descStr) {
                        let parsedType = null;
                        if (descStr.includes('[Ý tưởng]') || descStr === 'Ý tưởng') parsedType = 'Ý tưởng';
                        else if (descStr.includes('[Triển khai]') || descStr === 'Triển khai') parsedType = 'Triển khai';
                        if (parsedType && appMeta[item.id].type !== parsedType) { appMeta[item.id].type = parsedType; metaChanged = true; }
                        let coverMatch = descStr.match(/\[Cover:(.*?)\]/);
                        if (coverMatch) {
                            let extractedCover = coverMatch[1] === 'NONE' ? '' : coverMatch[1].trim();
                            if (appMeta[item.id].cover !== extractedCover) { appMeta[item.id].cover = extractedCover; metaChanged = true; }
                        }
                        let rawDesc = descStr.replace(/\[(Ý tưởng|Triển khai)\]/g, '').replace(/\[Cover:.*?\]/g, '').trim();
                        if (appMeta[item.id].desc !== rawDesc) { appMeta[item.id].desc = rawDesc; metaChanged = true; }
                    }
                    if (appMeta[item.id] && appMeta[item.id].name) { item.name = appMeta[item.id].name; }
                }
            });

            if (metaChanged) localforage.setItem('vinhloc_meta', appMeta).catch(e=>{});

            const folderListEl = document.getElementById('folderList'); 
            const fileListEl = document.getElementById('fileList');
            if(folderListEl) folderListEl.innerHTML = ''; 
            if(fileListEl) fileListEl.innerHTML = '';

            if (items.length === 0) { 
                if(folderListEl) folderListEl.innerHTML = '<div class="text-center text-gray-400 mt-8 w-full italic">Không có dữ liệu.</div>'; 
                return; 
            }

            const escapeHTML = (str) => { return str ? String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;') : ''; };
            const getMetaSafe = (id) => { return appMeta[id] || { desc: '', cover: '', type: 'Triển khai' }; };

            if (folderStack.length === 1 && !isSearchMode) {
                const megaRows = items.filter(i => i.type === 'folder' && getMetaSafe(i.id).type === currentCategory);
                if (megaRows.length === 0) { 
                    if(folderListEl) folderListEl.innerHTML = `<div class="text-center text-gray-400 mt-8 w-full italic">Chưa có dữ liệu trong mục ${currentCategory}</div>`; 
                    return; 
                }

                if(folderListEl) folderListEl.innerHTML = megaRows.map(item => {
                    const meta = getMetaSafe(item.id); const safeName = escapeHTML(item.name); 
                    return `
                    <div class="mega-row">
                        <div class="mega-header" onclick="window.toggleAccordion('${item.id}')">
                            <div class="flex items-center gap-3 overflow-hidden">
                                <i id="icon-${item.id}" class="fas fa-chevron-right text-gray-400 text-sm transition-transform duration-200 w-4 text-center"></i>
                                <div class="flex flex-col overflow-hidden">
                                    <span class="truncate uppercase text-blue-800 item-name-${item.id}">${item.name}</span>
                                    <span class="text-[11px] font-normal text-gray-500 truncate mt-1 item-desc-${item.id} ${meta.desc ? '' : 'hidden'}">${meta.desc || ''}</span>
                                </div>
                            </div>
                            <div class="relative flex-shrink-0" onclick="event.stopPropagation()">
                                <button onclick="window.toggleItemMenu('${item.id}', event)" class="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-blue-600 bg-gray-50 rounded-full transition"><i class="fas fa-ellipsis-v"></i></button>
                                <div id="menu-${item.id}" class="hidden absolute right-0 mt-2 w-44 bg-white rounded-2xl shadow-xl border border-gray-100 z-[500] py-1.5 text-sm item-action-menu overflow-hidden">
                                    <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition flex items-center" onclick="window.openInfo('${item.id}', '${safeName}', '${item.type}', 'mega', event)"><i class="fas fa-info-circle mr-3 text-blue-500 w-4"></i>Thông tin</div>
                                    <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-green-600 font-semibold transition border-t border-gray-50 flex items-center" onclick="window.uiPromptFolder('${item.id}', event)"><i class="fas fa-folder-plus mr-3 w-4"></i>Thư mục</div>
                                    <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition flex items-center" onclick="window.shareItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-share-nodes mr-3 text-green-500 w-4"></i>Chia sẻ</div>
                                    <div class="px-5 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold transition border-t border-gray-50 flex items-center" onclick="window.downloadItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-download mr-3 text-blue-500 w-4"></i>Tải xuống</div>
                                    <div class="px-5 py-3 hover:bg-red-50 cursor-pointer text-red-600 font-semibold transition border-t border-gray-50 flex items-center" onclick="window.handleDelete('${item.id}', '${item.type}', event)"><i class="fas fa-trash mr-3 w-4"></i>Xóa</div>
                                </div>
                            </div>
                        </div>
                        <div id="acc-${item.id}" class="hidden bg-white border-t border-gray-100"></div>
                    </div>`;
                }).join('');
                megaRows.forEach(row => { if (typeof expandedMegas !== 'undefined' && expandedMegas.includes(row.id) && window.toggleAccordion) window.toggleAccordion(row.id, true); });
            }
            else {
                const folders = items.filter(i => i.type === 'folder'); const files = items.filter(i => i.type !== 'folder');
                
                if (folders.length > 0 && folderListEl) {
                    folderListEl.innerHTML = folders.map(item => {
                        const meta = getMetaSafe(item.id); 
                        let isSelected = window.multiSelectState && window.multiSelectState.selectedIds.has(item.id);
                        const checkUi = isSelected ? `<div class="absolute -top-1 -right-1 z-20 bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-md"><i class="fas fa-check text-[10px]"></i></div>` : '';
                        let bgClass = isSelected ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50';
                        const safeName = escapeHTML(item.name); 
                        
                        const clickFolderAction = isSearchMode ? `window.openSearchResult('${item.id}', '${safeName}', 'folder', null, null)` : `window.loadFolder('${item.id}', '${safeName}', true)`;

                        return `
                        <div class="subfolder-row group relative border-b transition ${bgClass}" style="display: flex !important;" onclick="${clickFolderAction}">
                            <div class="relative shrink-0 cursor-pointer" onclick="event.stopPropagation(); window.toggleFileSelection ? window.toggleFileSelection('${item.id}', event) : null">
                                ${checkUi}
                                <img src="${meta.cover || ''}" class="w-12 h-12 rounded-lg object-cover shadow-sm item-cover-img-${item.id} ${meta.cover ? '' : 'hidden'}">
                                <div class="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center text-blue-500 text-xl item-cover-icon-${item.id} ${meta.cover ? 'hidden' : ''}"><i class="fas fa-folder"></i></div>
                            </div>
                            <div class="flex-1 overflow-hidden">
                                <h4 class="text-sm font-bold ${isSelected ? 'text-blue-800' : 'text-gray-800'} truncate item-name-${item.id}">${item.name}</h4>
                                <p class="text-[11px] text-gray-500 truncate mt-0.5 item-desc-${item.id} ${meta.desc ? '' : 'hidden'}">${meta.desc || 'Chưa có mô tả'}</p>
                            </div>
                            <div class="relative shrink-0" onclick="event.stopPropagation()">
                                <button onclick="window.toggleItemMenu('${item.id}', event)" class="px-3 py-2 text-gray-400 hover:text-blue-600 transition"><i class="fas fa-ellipsis-v"></i></button>
                                <div id="menu-${item.id}" class="hidden absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-lg border z-[500] py-1 text-sm item-action-menu">
                                    <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer font-semibold text-gray-700 flex items-center" onclick="window.shareItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-share-nodes mr-3 text-green-500 w-4"></i>Chia sẻ</div>
                                    <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer font-semibold text-gray-700 flex items-center" onclick="window.openInfo('${item.id}', '${safeName}', '${item.type}', 'sub', event)"><i class="fas fa-pen mr-3 text-blue-500 w-4"></i>Sửa</div>
                                    <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer font-semibold text-gray-700 border-t flex items-center" onclick="window.downloadItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-download mr-3 text-blue-500 w-4"></i>Tải xuống</div>
                                    <div class="px-4 py-3 hover:bg-red-50 text-red-600 cursor-pointer font-semibold border-t flex items-center" onclick="window.handleDelete('${item.id}', '${item.type}', event)"><i class="fas fa-trash mr-3 w-4"></i>Xóa</div>
                                </div>
                            </div>
                        </div>`;
                    }).join('');
                }

                if (files.length > 0 && fileListEl) {
                    fileListEl.innerHTML = files.map(item => {
                        let isImage = item.mimeType.includes('image'); let isSelected = window.multiSelectState && window.multiSelectState.selectedIds.has(item.id);
                        let imgUrl = item.tempUrl ? item.tempUrl : `https://drive.google.com/thumbnail?id=${item.id}&sz=w400`; let fullImgUrl = item.tempUrl ? item.tempUrl : `https://drive.google.com/thumbnail?id=${item.id}&sz=w2000`;
                        let visualEl = isImage ? `<img src="${imgUrl}" data-url="${fullImgUrl}" class="w-full h-full object-cover drive-img-item" loading="lazy">` : `<div class="w-full h-full flex items-center justify-center bg-gray-50"><i class="fas fa-play-circle text-gray-400 text-4xl"></i></div>`;
                        let isTemp = item.tempUrl ? `<div class="absolute inset-0 bg-white/60 flex flex-col items-center justify-center backdrop-blur-[2px] z-10 rounded-2xl"><div class="loader mb-2 border-blue-600"></div><span class="text-[10px] font-bold text-blue-600">Đang Up...</span></div>` : '';
                        let checkUi = isSelected ? `<div class="absolute top-2 left-2 z-20 bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-md"><i class="fas fa-check text-xs"></i></div>` : '';
                        let borderClass = isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : 'border-gray-100 bg-white hover:bg-gray-50';
                        const safeName = escapeHTML(item.name); 

                        const fileClickAction = isSearchMode ? `window.openSearchResult('${item.id}', '${safeName}', 'file', '${item.mimeType}', '${fullImgUrl}')` : `window.openMedia('${item.id}', '${item.mimeType}', '${safeName}', '${fullImgUrl}')`;

                        return `
                        <div class="p-2.5 rounded-2xl shadow-sm border flex flex-col relative transition ${borderClass}">
                            ${checkUi} ${isTemp}
                            <div class="absolute top-2 right-2 z-30">
                                <button onclick="window.toggleItemMenu('${item.id}', event)" class="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-600 bg-white/90 backdrop-blur-md rounded-full shadow-sm"><i class="fas fa-ellipsis-v"></i></button>
                                <div id="menu-${item.id}" class="hidden absolute right-0 mt-1 w-40 bg-white rounded-2xl shadow-xl border border-gray-100 z-[500] py-1 text-sm item-action-menu overflow-hidden">
                                    <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold flex items-center" onclick="window.shareItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-share-nodes mr-3 text-green-500 w-4"></i>Chia sẻ</div>
                                    <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold flex items-center" onclick="window.downloadItem('${item.id}', '${item.type}', '${safeName}', event)"><i class="fas fa-download mr-3 text-blue-500 w-4"></i>Tải xuống</div>
                                    <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer text-gray-700 font-semibold border-t flex items-center" onclick="window.openInfo('${item.id}', '${safeName}', '${item.type}', 'file', event)"><i class="fas fa-pen mr-3 text-blue-500 w-4"></i>Sửa</div>
                                    <div class="px-4 py-3 hover:bg-red-50 cursor-pointer text-red-600 font-semibold border-t flex items-center" onclick="window.handleDelete('${item.id}', '${item.type}', event)"><i class="fas fa-trash mr-3 w-4"></i>Xóa</div>
                                </div>
                            </div>
                            <div class="w-full h-32 flex items-center justify-center bg-gray-100 rounded-xl overflow-hidden cursor-pointer mb-3" onclick="${fileClickAction}">${visualEl}</div>
                            <div class="px-1 flex flex-col justify-center flex-1 cursor-pointer" onclick="window.toggleFileSelection ? window.toggleFileSelection('${item.id}', event) : null">
                                <span class="text-[13px] font-bold ${isSelected ? 'text-blue-700' : 'text-gray-800'} line-clamp-2 leading-tight drive-img-name item-name-${item.id}" title="${item.name}">${item.name}</span>
                                <span class="text-[10px] text-gray-400 mt-1 uppercase font-semibold">${item.mimeType.split('/')[1] || 'FILE'}</span>
                            </div>
                        </div>`;
                    }).join('');
                }
            }
        } catch(err) {
            console.error("LỖI RENDER_ITEMS:", err);
        } finally {
            window.smoothUpdateUI = tempSmooth; 
            if(window.smoothUpdateUI) window.smoothUpdateUI(appMeta);
            if (!isSearchMode && typeof currentFolderId !== 'undefined' && currentFolderId !== 'dummy_design_state') { 
                localforage.setItem('vinhloc_folder_cache', folderDataCache).catch(e=>{}); 
            }
        }
    };

    if (currentDriveItems && currentDriveItems.length > 0 && window.renderItems) window.renderItems(currentDriveItems);
    console.log("✅ PATCH 21 SAFE V2: Nút Back đã hoạt động chuẩn xác 100%!");
}, 10000);
// ==============================================================
// PATCH 22: CLICK LOGO HEADER ĐỂ VỀ NHANH TRANG CHỦ (MEGA-ROWS) - KHÔNG MỞ SIDEBAR
// ==============================================================
setTimeout(() => {
    // Tìm đúng tấm ảnh Logo nằm trong thẻ header
    const headerLogo = document.querySelector('header img[alt="Logo"]');
    
    if (headerLogo) {
        // Thêm các class hiệu ứng bấm cho Logo
        headerLogo.classList.add('cursor-pointer', 'hover:opacity-80', 'active:scale-90', 'transition-all', 'duration-200');
        
        headerLogo.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Nếu đang đứng sẵn ở trang chủ và không trong chế độ tìm kiếm thì bỏ qua
            if (folderStack.length <= 1 && !window.isSearching) return;
            
            // 1. Tắt hoàn toàn trạng thái và dọn rác thanh tìm kiếm (nếu có)
            const searchInput = document.getElementById('searchInput');
            const clearSearchBtn = document.getElementById('clearSearchBtn');
            if (searchInput) searchInput.value = '';
            if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
            window.isSearching = false;
            window.currentSearchResults = [];
            
            // 2. Tái cấu trúc bộ nhớ Stack về Gốc của Tab hiện tại (Bỏ qua switchCategory để GIỮ NGUYÊN SIDEBAR)
            folderStack = [{ id: ROOT_FOLDER_ID, name: currentCategory, scrollTop: 0 }];
            localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
            history.pushState({ id: ROOT_FOLDER_ID }, '', '');
            
            // 3. Ép tải giao diện gốc hiển thị danh sách Mega-row
            if (window.loadFolder) {
                window.loadFolder(ROOT_FOLDER_ID, currentCategory, false, false);
            }
        });
    }
    console.log("✅ PATCH 22: Đã tối ưu logic quay về trang chủ (chống mở sidebar)!");
}, 10500);
// ==============================================================
// PATCH 23: FIX LỖI UP ẢNH VÀO FOLDER ẢO & LỖI LINK CHIA SẺ THƯ MỤC
// ==============================================================

// BẮT THÔNG TIN LINK CHIA SẺ NGAY LẬP TỨC TRƯỚC KHI BỊ XÓA BỞI CÁC HÀM KHÁC
window.vinhloc_share_params = new URLSearchParams(window.location.search);

setTimeout(() => {
    // -----------------------------------------------------------------
    // FIX 1: LỖI UP ẢNH VÀO THƯ MỤC VỪA TẠO (DO CHƯA CÓ ID THẬT TỪ DRIVE)
    // -----------------------------------------------------------------
    
    // Cập nhật hàm thay thế ID ảo để nó đổi luôn ID của thư mục đang mở
    const originalReplaceTempId = window.replaceTempId || function(){};
    window.replaceTempId = function(tempId, realId) {
        if (appMeta[tempId]) {
            appMeta[realId] = appMeta[tempId];
            delete appMeta[tempId];
            localforage.setItem('vinhloc_meta', appMeta).catch(()=>{});
        }

        let itemIdx = currentDriveItems.findIndex(i => i.id === tempId);
        if (itemIdx > -1) { currentDriveItems[itemIdx].id = realId; delete currentDriveItems[itemIdx].isPending; }

        for (let fId in folderDataCache) {
            let idx = folderDataCache[fId].findIndex(i => i.id === tempId);
            if (idx > -1) { folderDataCache[fId][idx].id = realId; delete folderDataCache[fId][idx].isPending; }
        }

        for (let mId in subFolderCache) {
            let idx = subFolderCache[mId].findIndex(i => i.id === tempId);
            if (idx > -1) { subFolderCache[mId][idx].id = realId; delete subFolderCache[mId][idx].isPending; }
        }

        // -> SỬA LỖI Ở ĐÂY: Nếu đang đứng trong folder vừa tạo, đổi ID hiện tại sang ID thật ngay tắp lự!
        if (currentFolderId === tempId) {
            currentFolderId = realId;
        }
        
        // -> Đổi ID trong thanh đường dẫn (folderStack) để back/up không bị lỗi
        let stackChanged = false;
        folderStack.forEach(f => {
            if (f.id === tempId) { f.id = realId; stackChanged = true; }
        });
        if (stackChanged) localStorage.setItem('appFolderStack', JSON.stringify(folderStack));

        if (currentDriveItems.some(i => i.id === realId) || currentFolderId === realId) {
            if(window.renderItems) window.renderItems(currentDriveItems);
        }
    };

    // Bọc hàm up ảnh: Chặn không cho up nếu Folder chưa kịp tạo xong trên Drive
    if(window.handleMultipleFileUpload && !window.handleMultipleFileUpload.isWrappedForFakeId) {
        const originalUpload = window.handleMultipleFileUpload;
        window.handleMultipleFileUpload = async function(event) {
            if (currentFolderId && currentFolderId.startsWith('temp_folder_')) {
                showToast("Vẫn đang tạo thư mục...", true);
                if (typeof closeFab === 'function') closeFab();
                event.target.value = '';
                return; // Chặn đứng lệnh up ảnh ảo
            }
            return originalUpload(event);
        };
        window.handleMultipleFileUpload.isWrappedForFakeId = true;
    }


    // -----------------------------------------------------------------
    // FIX 2: LỖI LINK CHIA SẺ FOLDER (BỊ GHI ĐÈ BỞI MEGA-ROW KHI MỞ APP)
    // -----------------------------------------------------------------
    
    // Ghi đè lại hàm khởi tạo Database để xử lý Link chia sẻ đúng chuẩn
    window.initDatabase = async function() {
        try {
            let storedMeta = await localforage.getItem('vinhloc_meta');
            appMeta = storedMeta || {};

            if (Object.keys(appMeta).length === 0) {
                const folderListEl = document.getElementById('folderList');
                if (folderListEl) folderListEl.innerHTML = '<div class="text-center text-gray-500 mt-10 w-full"><div class="loader mx-auto mb-3 border-blue-400"></div>Đang chuẩn bị dữ liệu...</div>';
                try {
                    const metaRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getMeta' }) }).then(r => r.json());
                    if (metaRes && metaRes.success && metaRes.meta) {
                        appMeta = metaRes.meta; await localforage.setItem('vinhloc_meta', appMeta);
                    }
                } catch(e) {}
            }

            const storedFolderCache = await localforage.getItem('vinhloc_folder_cache');
            folderDataCache = storedFolderCache || {};
            const storedSubCache = await localforage.getItem('vinhloc_subfolder_cache');
            subFolderCache = storedSubCache || {};

            let metaCleaned = false;
            for (let id in appMeta) {
                if (appMeta[id].cover && appMeta[id].cover.length > 30000) { appMeta[id].cover = ''; metaCleaned = true; }
            }
            if (metaCleaned) await localforage.setItem('vinhloc_meta', appMeta);

            // --- SỬA LỖI CHIA SẺ NẰM Ở ĐÂY ---
            // Gọi lại cái link đã bắt được lúc mới mở App
            const sId = window.vinhloc_share_params.get('shareId');
            const sType = window.vinhloc_share_params.get('shareType');
            const sName = window.vinhloc_share_params.get('shareName');

            if (sId) {
                // Nếu là Link chia sẻ, KHÔNG TẢI Mega-row nữa, tải thẳng Folder chia sẻ
                if (sType === 'folder') {
                    folderStack = [ { id: ROOT_FOLDER_ID, name: "Triển khai", scrollTop: 0 }, { id: sId, name: sName || "Thư mục chia sẻ", scrollTop: 0 } ];
                    currentFolderId = sId;
                    localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
                    if(window.loadFolder) window.loadFolder(sId, sName || "Thư mục chia sẻ", false, false);
                } else {
                    if(window.loadFolder) window.loadFolder(ROOT_FOLDER_ID, "Triển khai", false, false);
                }
            } else {
                // Nếu mở web bình thường thì về trang chủ Triển khai
                if(window.loadFolder) window.loadFolder(ROOT_FOLDER_ID, "Triển khai", false, false);
            }

        } catch (err) {
            console.error("Lỗi tải DB:", err);
        }
    };

    // Áp dụng ép hiển thị luôn khi Patch vừa kích hoạt xong để vá ngay lập tức
    const sId = window.vinhloc_share_params.get('shareId');
    const sType = window.vinhloc_share_params.get('shareType');
    const sName = window.vinhloc_share_params.get('shareName');
    
    if (sId && sType === 'folder') {
        folderStack = [ { id: ROOT_FOLDER_ID, name: "Triển khai", scrollTop: 0 }, { id: sId, name: sName || "Thư mục chia sẻ", scrollTop: 0 } ];
        currentFolderId = sId;
        localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
        if(window.loadFolder) window.loadFolder(sId, sName || "Thư mục chia sẻ", false, false);
    }

    console.log("✅ PATCH 23: Đã sửa Lỗi Up Ảnh vào Thư mục ảo & Lỗi Link chia sẻ!");
}, 11000); // Khởi chạy trễ nhất hệ thống
// ==============================================================
// PATCH 24: THÊM NÚT CHIA SẺ THƯ MỤC HIỆN TẠI VÀO MENU HEADER
// ==============================================================
setTimeout(() => {
    // 1. Tạo hàm riêng để xử lý việc chia sẻ thư mục đang mở
    window.shareCurrentFolder = function(e) {
        if (e) e.stopPropagation();
        
        // Đóng menu header
        const headerDropdown = document.getElementById('headerDropdown');
        if (headerDropdown) headerDropdown.classList.add('hidden');

        // Lấy thông tin thư mục đang mở hiện tại
        if (folderStack.length > 1 && currentFolderId) {
            const currentFolder = folderStack[folderStack.length - 1];
            const folderName = currentFolder.name;
            
            // Tận dụng lại hàm shareItem có sẵn để sinh link và copy
            if (window.shareItem) {
                window.shareItem(currentFolderId, 'folder', folderName, e);
            }
        }
    };

    // 2. Ghi đè hàm buildHeaderMenu để chèn thêm nút "Chia sẻ" vào dưới cùng
    if (window.buildHeaderMenu) {
        const originalBuildHeaderMenu = window.buildHeaderMenu;
        
        window.buildHeaderMenu = function() {
            // Chạy hàm gốc để tạo ra các nút "Tất cả", "Đuôi file", "Xóa đã chọn"...
            originalBuildHeaderMenu();
            
            const headerDropdown = document.getElementById('headerDropdown');
            
            // CHỈ THÊM NÚT CHIA SẺ KHI ĐANG Ở TRONG THƯ MỤC (Không thêm ở ngoài Mega-row)
            if (headerDropdown && folderStack.length > 1) {
                const shareHtml = `
                    <div class="border-t border-gray-200 mt-1"></div>
                    <div class="px-5 py-3 hover:bg-green-50 cursor-pointer text-green-600 font-bold flex items-center justify-between transition" onclick="window.shareCurrentFolder(event)">
                        <span><i class="fas fa-share-nodes mr-2"></i>Chia sẻ</span>
                    </div>
                `;
                // Nối thêm vào dưới cùng của menu
                headerDropdown.innerHTML += shareHtml;
            }
        };
    }
    console.log("✅ PATCH 24: Đã thêm nút Chia sẻ thư mục vào Menu 3 chấm Header!");
}, 11500); // Khởi chạy trễ nhất để tích hợp trơn tru vào menu
// ==============================================================
// PATCH 25: ĐÁNH CHẶN TUYỆT ĐỐI LỖI CHỚP TRANG CHỦ KHI MỞ LINK SHARE
// ==============================================================
(function() {
    // Đọc tham số URL ngay nhịp đầu tiên khi file script vừa nạp (Trước khi bị luồng khác xóa)
    const initialParams = new URLSearchParams(window.location.search);
    if (initialParams.get('shareId')) {
        // Kích hoạt khiên bảo vệ độc quyền luồng chia sẻ
        window.vinhloc_is_sharing_boot = true;
        
        // Tự động gỡ bỏ khiên bảo vệ sau 5 giây để trả lại tự do hoàn toàn cho ứng dụng làm việc sau đó
        setTimeout(() => { window.vinhloc_is_sharing_boot = false; }, 5000);

        const applyHook = () => {
            if (window.loadFolder && !window.loadFolder.isSharedHooked) {
                const originalLoadFolder = window.loadFolder;
                window.loadFolder = function(folderId, folderName, isNewNavigation, isPopState) {
                    // CHIẾC KHIÊN PHẢN ĐÒN: Nghiêm cấm tuyệt đối luồng khởi động cũ nạp đè trang chủ ROOT
                    if (window.vinhloc_is_sharing_boot && folderId === ROOT_FOLDER_ID) {
                        console.log("🕷️ [Radar] Đã đánh chặn và tiêu diệt luồng khởi động cũ ghi đè nhầm trang chủ ROOT");
                        return; // Chặn đứng hoàn toàn lệnh lỗi
                    }
                    return originalLoadFolder(folderId, folderName, isNewNavigation, isPopState);
                };
                window.loadFolder.isSharedHooked = true;
            }
        };

        // Quét và khóa chặt hàm liên tục trong 1.5 giây đầu tiên để không hụt bất kỳ mili-giây nào của hệ thống
        applyHook();
        let attempts = 0;
        const hookInterval = setInterval(() => {
            applyHook();
            attempts++;
            if (attempts > 30) clearInterval(hookInterval);
        }, 50);
    }
})();
// ==============================================================
// PATCH 27 (V3): QUY TRÌNH CHUẨN TẠO MEGA-ROW, DRIVE DESCRIPTION & SHEET (ID THẬT)
// ==============================================================
setTimeout(() => {
    // 1. HÀM THAY ID ẢO THÀNH THẬT TRÊN GIAO DIỆN (SAU KHI SERVER CHẠY XONG)
    const originalReplaceTempId = window.replaceTempId || function(){};
    window.replaceTempId = function(tempId, realId) {
        // Đánh chặn Crawler: Tránh nhân bản nếu mây đã tải về trước
        const existsInCurrent = currentDriveItems.some(i => i.id === realId && !i.isPending);
        if (existsInCurrent) {
            if (window.purgeDeletedItem) window.purgeDeletedItem(tempId);
            return;
        }
        
        // Đổi key trong Meta từ ảo sang thật
        if (appMeta[tempId]) {
            appMeta[realId] = appMeta[tempId];
            delete appMeta[tempId];
            localforage.setItem('vinhloc_meta', appMeta).catch(()=>{});
        }

        // Đổi ID trong các mảng dữ liệu đang hiển thị
        let itemIdx = currentDriveItems.findIndex(i => i.id === tempId);
        if (itemIdx > -1) { currentDriveItems[itemIdx].id = realId; delete currentDriveItems[itemIdx].isPending; }

        for (let fId in folderDataCache) {
            let idx = folderDataCache[fId].findIndex(i => i.id === tempId);
            if (idx > -1) { folderDataCache[fId][idx].id = realId; delete folderDataCache[fId][idx].isPending; }
        }

        for (let mId in subFolderCache) {
            let idx = subFolderCache[mId].findIndex(i => i.id === tempId);
            if (idx > -1) { subFolderCache[mId][idx].id = realId; delete subFolderCache[mId][idx].isPending; }
        }

        if (currentFolderId === tempId) currentFolderId = realId;
        
        let stackChanged = false;
        folderStack.forEach(f => {
            if (f.id === tempId) { f.id = realId; stackChanged = true; }
        });
        if (stackChanged) localStorage.setItem('appFolderStack', JSON.stringify(folderStack));

        // Vẽ lại cục bộ ngay lập tức
        if (currentDriveItems.some(i => i.id === realId) || currentFolderId === realId) {
            if(window.renderItems) window.renderItems(currentDriveItems);
        }
    };

    // 2. HÀM TẠO FOLDER TRÊN GIAO DIỆN
    window.uiPromptFolder = function (targetParentId = null, e = null) {
        if (e) { e.stopPropagation(); document.querySelectorAll('.item-action-menu').forEach(menu => menu.classList.add('hidden')); }
        if (typeof closeFab === 'function') closeFab();

        document.getElementById('modalTitle').textContent = 'Thư mục mới';
        document.getElementById('modalDesc').classList.add('hidden');
        document.getElementById('modalInput').classList.remove('hidden');
        document.getElementById('modalInput').value = '';
        document.getElementById('modalInput').placeholder = "Nhập tên thư mục...";

        const btn = document.getElementById('modalConfirmBtn');
        btn.textContent = 'Tạo'; 
        btn.className = 'px-5 py-2 bg-blue-600 text-white font-bold rounded-xl';

        btn.onclick = () => {
            const val = document.getElementById('modalInput').value.trim();
            if (val) {
                const parentIdToUse = (targetParentId && typeof targetParentId === 'string') ? targetParentId : currentFolderId;
                closeModal();

                const isMegaRow = (parentIdToUse === ROOT_FOLDER_ID);
                const tempId = 'temp_folder_' + Date.now();
                const newItem = { id: tempId, name: val, type: 'folder', isPending: true };

                let targetCategory = "Triển khai"; 
                let targetDesc = ""; 

                // Nếu là Mega-row, thiết lập cấu trúc để gửi lên GAS
                if (isMegaRow) {
                    targetCategory = window.currentCategory || "Triển khai";
                    targetDesc = `[${targetCategory}]\n`; // Đóng dấu Loại lên Description Drive
                    
                    // Lưu Meta nội bộ tạm thời để render mượt
                    appMeta[tempId] = { type: targetCategory, desc: '', cover: '', name: val };
                    localforage.setItem('vinhloc_meta', appMeta).catch(()=>{});
                }

                // A. HIỂN THỊ TỨC THÌ LÊN GIAO DIỆN (CHƯA CẦN CHỜ MẠNG)
                if (parentIdToUse === currentFolderId) {
                    currentDriveItems.unshift(newItem);
                    folderDataCache[currentFolderId] = currentDriveItems;
                    window.renderItems(currentDriveItems);
                } else if (subFolderCache[parentIdToUse]) {
                    subFolderCache[parentIdToUse].unshift(newItem);
                    if (typeof window.renderSubFolders === 'function') window.renderSubFolders(parentIdToUse, subFolderCache[parentIdToUse]);
                }

                showToast(`<i class="fas fa-check mr-2"></i> Đã tạo mục "${val}"`);

                // B. ĐẨY LỆNH GỘP (CREATE DRIVE + SAVE SHEET) VÀO HÀNG ĐỢI
                addActionToQueue('createFolder', {
                    name: val,
                    folderId: parentIdToUse,
                    tempId: tempId,
                    description: targetDesc,
                    isMegaRow: isMegaRow,       // Kích hoạt cờ này để GAS biết và lưu vào Sheet
                    category: targetCategory    // Truyền Loại qua cho GAS ghi vào Sheet
                });
            }
        };
        document.getElementById('customModal').classList.remove('hidden'); document.getElementById('customModal').classList.add('flex');
        setTimeout(() => document.getElementById('modalInput').focus(), 100);
    };

    // 3. TỐI ƯU HÓA HÀNG ĐỢI QUEUE (GỌN GÀNG, KHÔNG CẦN CHỜ ĐỢI PHỨC TẠP)
    if(window.processActionQueue && !window.processActionQueue.isV3) {
        const originalProcessActionQueue = window.processActionQueue;
        
        window.processActionQueue = async function() {
            if (isQueueProcessing) return;
            isQueueProcessing = true;

            try {
                let queue = await localforage.getItem('vinhloc_action_queue') || [];

                while (queue.length > 0) {
                    let currentTask = queue[0];
                    try {
                        syncQueueCount++; updateSyncIndicator();

                        let response = await fetch(SCRIPT_URL, {
                            method: 'POST',
                            body: JSON.stringify({ action: currentTask.action, ...currentTask.payload, email: currentUserEmail })
                        });
                        let data = await response.json();

                        if (data.success || data.id || data.url) {
                            // Khi tạo thư mục xong, Drive trả về ID thật -> Thay thế ngay trên UI
                            if (currentTask.action === 'createFolder' && data.tempId && data.id) {
                                window.replaceTempId(data.tempId, data.id);
                                
                                // Nếu trong Queue đang có lệnh rename hoặc updateSingleMeta nào xài ID ảo, cập nhật luôn cho chúng
                                for(let i=1; i<queue.length; i++) {
                                    if (queue[i].payload && queue[i].payload.id === data.tempId) {
                                        queue[i].payload.id = data.id; 
                                    }
                                    if (queue[i].payload && queue[i].payload.meta && queue[i].payload.meta.id === data.tempId) {
                                        queue[i].payload.meta.id = data.id; 
                                    }
                                }
                            }
                            
                            queue.shift(); 
                            await localforage.setItem('vinhloc_action_queue', queue);
                        } else {
                            break;
                        }
                    } catch (networkError) {
                        break; // Mất mạng thì dừng, lát có mạng Queue chạy tiếp
                    } finally {
                        syncQueueCount--; updateSyncIndicator();
                    }
                }
            } catch (err) {
            } finally {
                isQueueProcessing = false;
            }
        };
        window.processActionQueue.isV3 = true;
    }
    
    console.log("✅ PATCH 27 V3: Quy chuẩn hóa hoàn toàn quá trình tạo Thư mục, 100% ID thật!");
}, 12500);
// ==============================================================
// PATCH 28 (V7 BẤT TỬ): UPLOAD CHUNKING VÀ KHÓA CHỐNG GHI ĐÈ 
// ==============================================================
const newUploadLogic = async function(event) {
    if (typeof closeFab === 'function') closeFab(); 
    const files = event.target.files; 
    if (!files || files.length === 0) return;
    
    if (currentFolderId && currentFolderId.startsWith('temp_folder_')) {
        showToast("Vui lòng đợi thư mục tạo xong...", true);
        event.target.value = ''; return;
    }
    
    syncQueueCount++; updateSyncIndicator(); 
    let uploadQueue = [];
    
    // Dàn khung "Đang Up..." lên giao diện
    for (let i = 0; i < files.length; i++) {
        let file = files[i]; 
        let fakeId = 'temp_file_' + Date.now() + '_' + i; 
        let tempUrl = URL.createObjectURL(file); 
        let newItem = { id: fakeId, name: file.name, mimeType: file.type, type: 'file', tempUrl: tempUrl, isPending: true };
        uploadQueue.push({ file: file, id: fakeId, itemRef: newItem }); 
        currentDriveItems.unshift(newItem); 
    }
    folderDataCache[currentFolderId] = currentDriveItems; 
    window.renderItems(currentDriveItems);
    
    // Xin Thẻ bài
    let token = null;
    try {
        let tokenRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getToken' }) }).then(r => r.json());
        if (tokenRes && tokenRes.success) token = tokenRes.token;
    } catch(e) {}

    if (!token) {
        showToast("Lỗi: Không lấy được quyền Upload.", true);
        for (let obj of uploadQueue) currentDriveItems = currentDriveItems.filter(i => i.id !== obj.id);
        folderDataCache[currentFolderId] = currentDriveItems; window.renderItems(currentDriveItems);
        syncQueueCount--; updateSyncIndicator(); event.target.value = ''; return;
    }

    // Bơm file vào Đường hầm Drive
    for (let obj of uploadQueue) {
        try {
            if (obj.file.size === 0) throw new Error("File rỗng");
            let realId = null;

            let initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
                method: 'POST',
                headers: { 
                    'Authorization': 'Bearer ' + token, 
                    'Content-Type': 'application/json',
                    'X-Upload-Content-Type': obj.file.type || 'application/octet-stream'
                },
                body: JSON.stringify({ name: obj.file.name, parents: [currentFolderId] })
            });

            let uploadUrl = initRes.headers.get('Location') || initRes.headers.get('location');
            if (!uploadUrl) {
                let errText = await initRes.text();
                if(errText.includes('404')) throw new Error("Lỗi 404: Thư mục không tồn tại.");
                throw new Error(`Google chặn khởi tạo Upload.`);
            }

            const CHUNK_SIZE = 5242880; 
            let start = 0;
            let uploadedData = null;

            // Thuật toán Băm nhỏ File chống Timeout
            while (start < obj.file.size) {
                let end = Math.min(start + CHUNK_SIZE, obj.file.size);
                let chunk = obj.file.slice(start, end);
                
                let chunkRes = await fetch(uploadUrl, {
                    method: 'PUT',
                    headers: { 'Content-Range': `bytes ${start}-${end - 1}/${obj.file.size}` },
                    body: chunk
                });

                if (chunkRes.status === 308) {
                    start = end;
                } else if (chunkRes.ok) {
                    uploadedData = await chunkRes.json();
                    break;
                } else {
                    throw new Error(`Đứt mạng khi tải.`);
                }
            }

            if (uploadedData && uploadedData.id) realId = uploadedData.id;
            else throw new Error("Không lấy được ID file.");
            
            // Xong -> Gỡ giao diện Đang Up
            let uploadedItem = currentDriveItems.find(i => i.id === obj.id);
            if (uploadedItem && realId) {
                uploadedItem.id = realId; delete uploadedItem.isPending; delete uploadedItem.tempUrl;
            }
            if (folderDataCache[currentFolderId]) {
                let cacheItem = folderDataCache[currentFolderId].find(i => i.id === obj.id);
                if (cacheItem && realId) { cacheItem.id = realId; delete cacheItem.isPending; delete cacheItem.tempUrl; }
            }
            
            window.renderItems(currentDriveItems); 
            URL.revokeObjectURL(obj.itemRef.tempUrl); 

        } catch(err) { 
            // Nếu có lỗi, XÓA NGAY khung UI để chống đơ
            showToast(`Lỗi ${obj.file.name}: ${err.message}`, true); 
            currentDriveItems = currentDriveItems.filter(i => i.id !== obj.id); 
            folderDataCache[currentFolderId] = currentDriveItems;
            window.renderItems(currentDriveItems);
        }
    }
    syncQueueCount--; updateSyncIndicator(); event.target.value = ''; 
};

// ĐÓNG BĂNG HÀM UPLOAD: CẤM TUYỆT ĐỐI CÁC PATCH CŨ GHI ĐÈ LÊN!
try {
    Object.defineProperty(window, 'handleMultipleFileUpload', {
        value: newUploadLogic,
        writable: false,
        configurable: false
    });
} catch (e) {
    window.handleMultipleFileUpload = newUploadLogic;
}
// ==============================================================
// HIỂN THỊ SỐ PHIÊN BẢN NGAY DƯỚI CÁC MỤC TRONG SIDEBAR
// ==============================================================
setTimeout(() => {
    // Tìm thẳng vào vùng chứa danh sách mục menu
    const sidebarMenuContainer = document.querySelector('#sidebar .flex-1');
    
    if (sidebarMenuContainer) {
        // 1. Tự động đi tìm số phiên bản đang chạy trong HTML
        let currentVersion = "Không rõ";
        const scripts = document.querySelectorAll('script');
        scripts.forEach(s => {
            if (s.src && s.src.includes('script.js?v=')) {
                // Bóc tách lấy đúng con số sau chữ v=
                const match = s.src.match(/v=([0-9.]+)/);
                if (match && match[1]) currentVersion = match[1];
            }
        });

        // 2. Xóa thẻ cũ (nếu có) để tránh bị nhân đôi khi lướt web
        const oldVerDiv = document.getElementById('app-version-display');
        if (oldVerDiv) oldVerDiv.remove();

        // 3. Tạo thẻ hiển thị mới
        const versionDiv = document.createElement('div');
        versionDiv.id = 'app-version-display';
        
        // SỬA Ở ĐÂY: Dùng pl-[24px] để khớp chính xác 100% với (20px padding + 4px border) của menu
        versionDiv.className = 'flex items-center gap-3 py-4 mt-2 pl-[24px] pr-[20px] text-[11px]  text-red-400 tracking-widest opacity-80 cursor-default';
        
        // Icon được fix cứng độ rộng w-6 và căn giữa giống hệt menu
        versionDiv.innerHTML = `<i class="fas fa-code-branch w-6 text-center"></i> Phiên bản ${currentVersion}`;
        
        sidebarMenuContainer.appendChild(versionDiv);
    }
}, 1500);
// ==============================================================
// PATCH 29: SỬ DỤNG BÀN PHÍM (CTRL +/-) ĐỂ PHÓNG TO/THU NHỎ LƯỚI
// ==============================================================
setTimeout(() => {
    // 1. Tạo hàm điều khiển số cột Grid toàn cục
    window.changeGridCols = function(delta) {
        // Lấy số lượng cột hiện tại từ bộ nhớ (hoặc mặc định là 2)
        let currentCols = parseInt(localStorage.getItem('vinhloc_grid_cols')) || 2;
        
        // Tính toán số cột mới (bị kẹp giữa 2 và 6)
        let newCols = Math.max(2, Math.min(currentCols + delta, 6));
        
        const fileList = document.getElementById('fileList');
        // Bỏ qua nếu không tìm thấy khung hoặc đang ở chế độ xem List
        if (!fileList || fileList.classList.contains('list-view')) return;
        
        // Áp dụng CSS thay đổi số cột
        fileList.style.gridTemplateColumns = `repeat(${newCols}, minmax(0, 1fr))`;
        
        // Tính toán tỷ lệ kích thước (scale) để các thành phần bên trong co giãn tương ứng
        const scaleFactor = (2 / newCols).toFixed(2);
        fileList.style.setProperty('--col-scale', scaleFactor);
        
        // Lưu lại để lần sau mở web vẫn giữ nguyên mức thu phóng
        localStorage.setItem('vinhloc_grid_cols', newCols);
        
        // Cập nhật biến cục bộ bên trong màn Design (nếu đang bật)
        const btnDecrease = document.querySelector('#design-grid-controls button[title="Giảm số cột (Phóng to)"]');
        if (btnDecrease) {
            // Nháy nhẹ nút để báo hiệu (tùy chọn)
            btnDecrease.style.transform = 'scale(0.9)';
            setTimeout(() => btnDecrease.style.transform = 'scale(1)', 100);
        }
    };

    // 2. Bắt sự kiện phím tắt từ bàn phím
    document.addEventListener('keydown', function(e) {
        // Kiểm tra phím Ctrl (trên Windows) hoặc phím Command (trên Mac)
        if (e.ctrlKey || e.metaKey) {
            // Nếu bấm phím Trừ (-) hoặc Shift + Trừ (_)
            if (e.key === '-' || e.key === '_') {
                e.preventDefault(); // Chặn trình duyệt thu nhỏ toàn bộ trang web
                window.changeGridCols(1); // Tăng thêm 1 cột (Làm phần tử nhỏ đi)
            } 
            // Nếu bấm phím Cộng (+) hoặc Dấu Bằng (=)
            else if (e.key === '=' || e.key === '+') {
                e.preventDefault(); // Chặn trình duyệt phóng to toàn bộ trang web
                window.changeGridCols(-1); // Giảm đi 1 cột (Làm phần tử to lên)
            }
        }
    }, { passive: false }); // Cần passive: false để e.preventDefault() hoạt động

    console.log("✅ PATCH 29: Đã kích hoạt Phím tắt Ctrl +/- để Phóng to/Thu nhỏ lưới!");
}, 15000); // Khởi chạy trễ để đảm bảo fileList đã xuất hiện
// ==============================================================
// PATCH 30: ÉP CÁC Ô FILE THÀNH HÌNH VUÔNG CHUẨN (ASPECT RATIO 1:1)
// ==============================================================
setTimeout(() => {
    // Tạo một thẻ <style> động để ghi đè giao diện
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
        /* Tìm tất cả các khung chứa ảnh (đang bị khóa h-32) bên trong danh sách file */
        #fileList .h-32 {
            height: auto !important;         /* Xóa bỏ chiều cao cố định 128px */
            aspect-ratio: 1 / 1 !important;  /* Ép tỷ lệ vuông 1:1 tuyệt đối */
            width: 100% !important;          /* Rộng full viền thẻ cha */
        }
        
        /* Hiệu ứng bo góc và đổ bóng nhẹ khi hover vào ảnh để trải nghiệm Desktop xịn hơn */
        #fileList .drive-img-item {
            transition: transform 0.3s ease;
        }
        #fileList .h-32:hover .drive-img-item {
            transform: scale(1.05); /* Phóng to ảnh nhẹ nhàng khi rê chuột */
        }
    `;
    // Gắn style này vào hệ thống
    document.head.appendChild(styleEl);

    console.log("✅ PATCH 30: Đã hô biến các file thành Ô Vuông 1:1 hoàn hảo!");
}, 500); // Chạy rất sớm để không bị giật giao diện
// ==============================================================
// PATCH 31: FIX LỖI UPLOAD VIDEO (THUMBNAIL & DRIVE PLAYER)
// ==============================================================
setTimeout(() => {
    // ---------------------------------------------------------
    // 1. SỬA LỖI UPLOAD: BƠM "MIMETYPE" ĐỂ DRIVE XỬ LÝ VIDEO
    // ---------------------------------------------------------
    const fixedUploadLogic = async function(event) {
        if (typeof closeFab === 'function') closeFab(); 
        const files = event.target.files; 
        if (!files || files.length === 0) return;
        
        if (currentFolderId && currentFolderId.startsWith('temp_folder_')) {
            showToast("Vui lòng đợi thư mục tạo xong...", true);
            event.target.value = ''; return;
        }
        
        syncQueueCount++; updateSyncIndicator(); 
        let uploadQueue = [];
        
        for (let i = 0; i < files.length; i++) {
            let file = files[i]; 
            let fakeId = 'temp_file_' + Date.now() + '_' + i; 
            let tempUrl = URL.createObjectURL(file); 
            let newItem = { id: fakeId, name: file.name, mimeType: file.type, type: 'file', tempUrl: tempUrl, isPending: true };
            uploadQueue.push({ file: file, id: fakeId, itemRef: newItem }); 
            currentDriveItems.unshift(newItem); 
        }
        folderDataCache[currentFolderId] = currentDriveItems; 
        window.renderItems(currentDriveItems);
        
        let token = null;
        try {
            let tokenRes = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getToken' }) }).then(r => r.json());
            if (tokenRes && tokenRes.success) token = tokenRes.token;
        } catch(e) {}

        if (!token) {
            showToast("Lỗi: Không lấy được quyền Upload.", true);
            for (let obj of uploadQueue) currentDriveItems = currentDriveItems.filter(i => i.id !== obj.id);
            folderDataCache[currentFolderId] = currentDriveItems; window.renderItems(currentDriveItems);
            syncQueueCount--; updateSyncIndicator(); event.target.value = ''; return;
        }

        for (let obj of uploadQueue) {
            try {
                if (obj.file.size === 0) throw new Error("File rỗng");
                let realId = null;

                let initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
                    method: 'POST',
                    headers: { 
                        'Authorization': 'Bearer ' + token, 
                        'Content-Type': 'application/json',
                        'X-Upload-Content-Type': obj.file.type || 'application/octet-stream'
                    },
                    // [QUAN TRỌNG]: ÉP DRIVE HIỂU ĐÂY LÀ VIDEO THÔNG QUA MIMETYPE CỦA BODY
                    body: JSON.stringify({ 
                        name: obj.file.name, 
                        mimeType: obj.file.type || 'application/octet-stream', 
                        parents: [currentFolderId] 
                    })
                });

                let uploadUrl = initRes.headers.get('Location') || initRes.headers.get('location');
                if (!uploadUrl) throw new Error(`Google chặn khởi tạo Upload.`);

                const CHUNK_SIZE = 5242880; 
                let start = 0; let uploadedData = null;

                while (start < obj.file.size) {
                    let end = Math.min(start + CHUNK_SIZE, obj.file.size);
                    let chunk = obj.file.slice(start, end);
                    let chunkRes = await fetch(uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${obj.file.size}` },
                        body: chunk
                    });

                    if (chunkRes.status === 308) start = end;
                    else if (chunkRes.ok) { uploadedData = await chunkRes.json(); break; }
                    else throw new Error(`Đứt mạng khi tải.`);
                }

                if (uploadedData && uploadedData.id) realId = uploadedData.id; else throw new Error("Không lấy được ID file.");
                
                let uploadedItem = currentDriveItems.find(i => i.id === obj.id);
                if (uploadedItem && realId) { uploadedItem.id = realId; delete uploadedItem.isPending; delete uploadedItem.tempUrl; }
                if (folderDataCache[currentFolderId]) {
                    let cacheItem = folderDataCache[currentFolderId].find(i => i.id === obj.id);
                    if (cacheItem && realId) { cacheItem.id = realId; delete cacheItem.isPending; delete cacheItem.tempUrl; }
                }
                window.renderItems(currentDriveItems); URL.revokeObjectURL(obj.itemRef.tempUrl); 

            } catch(err) { 
                showToast(`Lỗi ${obj.file.name}: ${err.message}`, true); 
                currentDriveItems = currentDriveItems.filter(i => i.id !== obj.id); 
                folderDataCache[currentFolderId] = currentDriveItems; window.renderItems(currentDriveItems);
            }
        }
        syncQueueCount--; updateSyncIndicator(); event.target.value = ''; 
    };

    // Hàm chọn nhiều file (Tái tạo lại để né Override)
    async function pickLocalFilesMultipleFixed({ accept = 'image/*', callback }) {
        try {
            if(window.showOpenFilePicker) {
                const pickerTypes = [];
                if(accept.includes('image')) pickerTypes.push({ description: 'Images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'] } });
                if(accept.includes('video')) pickerTypes.push({ description: 'Videos', accept: { 'video/*': ['.mp4', '.mov', '.webm', '.mkv'] } });
                const handles = await window.showOpenFilePicker({ multiple: true, excludeAcceptAllOption: true, types: pickerTypes });
                const files = []; for(const handle of handles) files.push(await handle.getFile());
                callback({ target: { files } }); return;
            }
        } catch(err) {}
        const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = true; 
        input.style.display = 'none'; document.body.appendChild(input); 
        input.addEventListener('change', callback); input.click(); setTimeout(()=>{ input.remove(); }, 10000);
    }

    // Gắn logic Upload đúng chuẩn vào nút Up Ảnh / Up Video
    const uploadImageLabel = document.querySelector('label:has(#uploadImage)');
    if(uploadImageLabel) uploadImageLabel.onclick = async function(e){ e.preventDefault(); e.stopPropagation(); await pickLocalFilesMultipleFixed({ accept:'image/*', callback: fixedUploadLogic }); };

    const uploadVideoLabel = document.querySelector('label:has(#uploadVideo)');
    if(uploadVideoLabel) uploadVideoLabel.onclick = async function(e){ e.preventDefault(); e.stopPropagation(); await pickLocalFilesMultipleFixed({ accept:'video/*', callback: fixedUploadLogic }); };


    // ---------------------------------------------------------
    // 2. SỬA LỖI UI: BẬT HIỂN THỊ THUMBNAIL CHO VIDEO VÀ OVERLAY PLAY
    // ---------------------------------------------------------
    if (window.renderItems && !window.renderItems.isVideoPatched) {
        const originalRenderItemsP31 = window.renderItems;
        window.renderItems = function(items, isSearchMode = false) {
            // Chạy hàm vẽ giao diện nguyên bản
            originalRenderItemsP31(items, isSearchMode);
            
            // Can thiệp sửa ngay các khối hiển thị Video
            const videoFiles = items.filter(i => i.type !== 'folder' && i.mimeType && i.mimeType.includes('video'));
            
            videoFiles.forEach(item => {
                const nameEl = document.querySelector(`.item-name-${item.id}`);
                if (nameEl) {
                    const cardEl = nameEl.closest('.p-2\\.5');
                    if (cardEl) {
                        const visualContainer = cardEl.querySelector('.w-full.h-32');
                        if (visualContainer) {
                            if (item.tempUrl && item.tempUrl.startsWith('blob:')) {
                                // Nếu đang up ngầm -> Phát video nội bộ
                                visualContainer.innerHTML = `
                                    <div class="relative w-full h-full bg-black rounded-xl overflow-hidden">
                                        <video src="${item.tempUrl}" class="w-full h-full object-cover" muted autoplay playsinline loop></video>
                                    </div>`;
                            } else {
                                // Nếu đã up lên mây -> Lấy Thumbnail từ Drive và gắn logo Play
                                let thumbUrl = `https://drive.google.com/thumbnail?id=${item.id}&sz=w400`;
                                visualContainer.innerHTML = `
                                    <div class="relative w-full h-full bg-black rounded-xl overflow-hidden">
                                        <img src="${thumbUrl}" class="w-full h-full object-cover drive-img-item" loading="lazy" onerror="this.src='https://via.placeholder.com/400/000000/FFFFFF?text=Processing...'">
                                        <div class="absolute inset-0 flex items-center justify-center bg-black/30 transition hover:bg-black/50">
                                            <i class="fas fa-play-circle text-white text-3xl opacity-90 drop-shadow-md"></i>
                                        </div>
                                    </div>`;
                            }
                        }
                    }
                }
            });
        };
        window.renderItems.isVideoPatched = true;
    }


    // ---------------------------------------------------------
    // 3. SỬA LỖI TRÌNH PHÁT MEDIA: NHÚNG BẰNG IFRAME CỦA GOOGLE DRIVE
    // ---------------------------------------------------------
    if (window.openMedia && !window.openMedia.isVideoPatched) {
        const originalOpenMediaP31 = window.openMedia;
        window.openMedia = function(id, mimeType, name, url) {
            // Mở khung xem ảnh cơ bản
            originalOpenMediaP31(id, mimeType, name, url);
            
            // Xử lý nạp ruột nếu là Video
            if (mimeType && mimeType.includes('video')) {
                const mediaContent = document.getElementById('mediaContent');
                if (mediaContent) {
                    // Nếu là File đang up trên máy
                    if (url && url.startsWith('blob:')) {
                        mediaContent.innerHTML = `
                            <video controls class="max-w-full max-h-full rounded-lg" src="${url}" autoplay playsinline></video>
                        `;
                    } else {
                        // Nếu là File đã có trên Drive -> Bắt buộc dùng Iframe Player của Google Drive
                        mediaContent.innerHTML = `
                            <iframe src="https://drive.google.com/file/d/${id}/preview" 
                                    class="w-full h-full rounded-lg bg-black" 
                                    frameborder="0" 
                                    allow="autoplay; fullscreen">
                            </iframe>
                        `;
                    }
                }
            }
        };
        window.openMedia.isVideoPatched = true;
    }

    // Refresh UI để hiển thị thumbnail Video ngay lập tức
    if (currentDriveItems && currentDriveItems.length > 0) window.renderItems(currentDriveItems);
    
    console.log("✅ PATCH 31: Đã nâng cấp Upload Video, Thumbnail Drive & Trình phát iframe!");
}, 16000);
// ==============================================================
// PATCH 32: MẠNG LƯỚI "NÃO NHỆN" TOÀN CẦU (BẢN CHUẨN TỨC THÌ)
// ==============================================================

// --------------------------------------------------------------
// PHẦN 1: "TẢI NÃO" - CHẠY NGAY LẬP TỨC Ở GIÂY THỨ 0
// --------------------------------------------------------------
(function() {
    const originalInitDatabaseP32 = window.initDatabase;
    window.initDatabase = async function() {
        try {
            // Kiểm tra siêu tốc xem ổ cứng có trống không
            const localFolderCache = await localforage.getItem('vinhloc_folder_cache') || {};
            const isCacheEmpty = Object.keys(localFolderCache).length <= 1;

            if (isCacheEmpty) {
                const folderListEl = document.getElementById('folderList');
                if (folderListEl) folderListEl.innerHTML = '<div class="text-center text-blue-600 mt-12 w-full"><div class="loader mx-auto mb-4 border-blue-600"></div><span class="font-bold animate-pulse">Đang đồng bộ dữ liệu mạng lưới...</span></div>';

                // Đi "Tải Não" ngay lập tức
                const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'loadGlobalCache' }) }).then(r => r.json());

                if (res && res.success && res.data) {
                    folderDataCache = res.data.folderData || {};
                    subFolderCache = res.data.subData || {};
                    await localforage.setItem('vinhloc_folder_cache', folderDataCache);
                    await localforage.setItem('vinhloc_subfolder_cache', subFolderCache);
                    console.log("🕷️ Đã cấy ghép Não Nhện thành công ngay giây số 0!");
                }
            }
        } catch(e) { console.error("Lỗi cấy ghép Não Nhện:", e); }

        // Móc nối lại vào hàm khởi tạo gốc (chứa Patch 23 xử lý link chia sẻ) để chạy tiếp
        if (originalInitDatabaseP32) await originalInitDatabaseP32();
    };
})();

// --------------------------------------------------------------
// PHẦN 2: "BƠM NÃO" & BẮT SỰ KIỆN - CHỜ 17 GIÂY ĐỂ ỔN ĐỊNH HỆ THỐNG
// --------------------------------------------------------------
setTimeout(() => {
    window.vinhloc_cache_modified = false;

    // Bắt sự kiện mỗi khi giao diện có biến động (ai đó vừa up file, tạo thư mục...)
    if (window.renderItems) {
        const originalRenderItemsP32 = window.renderItems;
        window.renderItems = function(items, isSearchMode = false) {
            if (!isSearchMode) window.vinhloc_cache_modified = true;
            return originalRenderItemsP32(items, isSearchMode);
        };
    }

    // Trạm phát sóng: Cứ 3 phút kiểm tra 1 lần, có thay đổi thì Bơm lên mây
    setInterval(async () => {
        if (window.vinhloc_cache_modified && Object.keys(folderDataCache).length > 0) {
            try {
                window.vinhloc_cache_modified = false; 
                await fetch(SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: 'saveGlobalCache',
                        cacheData: JSON.stringify({ folderData: folderDataCache, subData: subFolderCache })
                    })
                });
                console.log("📡 Đã phát sóng Não Nhện lên Drive cho các thiết bị khác!");
            } catch(e) { window.vinhloc_cache_modified = true; }
        }
    }, 180000); // 3 phút

    console.log("✅ PATCH 32: Đã kích hoạt Trạm Phát Sóng Não Nhện!");
}, 17000);
// ==============================================================
// PATCH 33 (V2): GẮN ẢNH DECOR ÉP SÁT ĐÁY SIDEBAR & HEADER
// ==============================================================
setTimeout(() => {
    // ---------------------------------------------------------
    // 1. GẮN ẢNH VÀO CẠNH PHẢI HEADER
    // ---------------------------------------------------------
    const header = document.querySelector('header');
    if (header) {
        header.style.position = 'relative';
        header.style.overflow = 'hidden'; 
        
        // Xóa ảnh cũ nếu có để tránh lỗi nhân đôi khi load lại
        const oldHeaderImg = header.querySelector('.vl-decor-header');
        if(oldHeaderImg) oldHeaderImg.remove();

        const rightHeaderImg = document.createElement('img');
        rightHeaderImg.src = 'vl_right_header.png';
        rightHeaderImg.className = 'vl-decor-header absolute right-0 top-0 h-full w-auto object-contain pointer-events-none z-[0]';

        Array.from(header.children).forEach(child => {
            if (child.style && !child.classList.contains('vl-decor-header')) {
                child.style.position = 'relative';
                child.style.zIndex = '10';
            }
        });
        header.insertBefore(rightHeaderImg, header.firstChild);
    }

    // ---------------------------------------------------------
    // 2. GẮN ẢNH VÀO ĐÁY SIDEBAR (ÉP SÁT 100%)
    // ---------------------------------------------------------
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        // Xóa ảnh cũ nếu có
        const oldFooter = sidebar.querySelector('.vl-decor-footer');
        if(oldFooter) oldFooter.remove();

        const footerImgWrapper = document.createElement('div');
        // mt-auto: đẩy xuống tận cùng
        // flex & leading-[0]: Khử khoảng trống line-height tàng hình của HTML
        // Đã XÓA "pb-2" để khung ảnh chạm sát 100% cạnh dưới
        footerImgWrapper.className = 'vl-decor-footer w-full mt-auto shrink-0 flex items-end leading-[0] bg-transparent'; 

        const footerImg = document.createElement('img');
        footerImg.src = 'vl_foot_slidebar.png';
        // block, m-0, p-0 để triệt tiêu mọi khoảng hở cuối cùng
        footerImg.className = 'w-full h-auto object-contain block m-0 p-0 pointer-events-none';

        footerImgWrapper.appendChild(footerImg);
        sidebar.appendChild(footerImgWrapper);
    }
    
    console.log("✅ PATCH 33 (V2): Đã gắn ảnh Decor ép sát viền đáy 100%!");
}, 800);
// ==============================================================
// PATCH 34: FIX LỖI CLICK ĐƯỜNG DẪN BỊ GOM CHUNG MEGA-ROW
// ==============================================================
setTimeout(() => {
    // 1. Vá trực tiếp hàm goToFolder (Hàm chuyên xử lý click trên thanh đường dẫn)
    if (window.goToFolder) {
        const originalGoToFolder = window.goToFolder;
        window.goToFolder = function(index) {
            // Nếu click vào mục số 0 (Mục Gốc: Triển khai / Ý tưởng)
            if (index === 0) {
                const targetCategory = folderStack[0].name; 
                
                // Ép biến toàn cục về đúng loại Tab
                window.currentCategory = targetCategory;
                
                // Tái cấu trúc lại bộ nhớ, cắt bỏ toàn bộ phần đuôi dư thừa
                folderStack = [{ id: ROOT_FOLDER_ID, name: targetCategory, scrollTop: 0 }];
                window.currentFolderId = ROOT_FOLDER_ID;
                localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
                
                // Gọi tải lại thư mục gốc
                if (window.loadFolder) {
                    window.loadFolder(ROOT_FOLDER_ID, targetCategory, false, false);
                }
                return; // Chặn đứng luồng code cũ gây lỗi
            }
            return originalGoToFolder(index);
        };
    }

    // 2. Chốt chặn cuối cùng vào lõi loadFolder: Chống mọi nỗ lực đẩy sai Stack
    if (window.loadFolder && !window.loadFolder.isBreadcrumbClamped) {
        const cachedLoadF = window.loadFolder;
        window.loadFolder = function(folderId, folderName, isNewNavigation, isPopState) {
            // Nếu đích đến là Gốc (ROOT)
            if (folderId === ROOT_FOLDER_ID) {
                const targetCategory = folderName || window.currentCategory || "Triển khai";
                window.currentCategory = targetCategory;
                
                // Khóa cứng Stack về 1 phần tử
                folderStack = [{ id: ROOT_FOLDER_ID, name: targetCategory, scrollTop: 0 }];
                window.currentFolderId = ROOT_FOLDER_ID;
                localStorage.setItem('appFolderStack', JSON.stringify(folderStack));
                
                // Ép isNewNavigation = false để không bị đẩy thêm lớp ảo
                return cachedLoadF(folderId, folderName, false, isPopState);
            }
            return cachedLoadF(folderId, folderName, isNewNavigation, isPopState);
        };
        window.loadFolder.isBreadcrumbClamped = true;
    }

    console.log("✅ PATCH 34: Đã fix triệt để lỗi click đường dẫn bị gom chung Tab!");
}, 18500); // Khởi chạy sau cùng để đảm bảo bắt đè được các hàm gốc
// ==============================================================
// PATCH 36: TẠO NHÃN "NEW_FOLDER.PNG" CHO MEGA-ROW (ĐỒNG BỘ ĐA THIẾT BỊ)
// ==============================================================
setTimeout(() => {
    // 1. CHÈN CSS GIAO DIỆN CHO NHÃN NEW
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
        .mega-new-label-img {
            position: absolute;
            right: 52px; /* Đẩy sang trái để nằm chính xác bên trái nút 3 chấm */
            top: 0;
            height: 100%; /* Bằng đúng 100% chiều cao của thẻ cha mega-row item */
            width: auto;
            object-fit: contain;
            padding: 8px 0; /* Padding nhẹ để ảnh không dính sát viền trên dưới */
            z-index: 10;
            pointer-events: none; /* Tránh cản trở thao tác click mở folder */
            animation: pulse-new-label 2s infinite ease-in-out;
        }
        
        @keyframes pulse-new-label {
            0%, 100% { transform: scale(1); opacity: 1; filter: drop-shadow(0 2px 4px rgba(239,68,68,0.3)); }
            50% { transform: scale(1.08); opacity: 0.85; filter: drop-shadow(0 4px 8px rgba(239,68,68,0.5)); }
        }
    `;
    document.head.appendChild(styleEl);

    // 2. KHỞI TẠO BỘ NHỚ LƯU TRỮ TRẠNG THÁI "ĐÃ XEM"
    let knownMegas = JSON.parse(localStorage.getItem('vinhloc_known_megas')) || [];
    let isLegacyCleared = localStorage.getItem('vinhloc_legacy_megas_cleared') === 'true';

    // 3. THIẾT LẬP MỐC DỮ LIỆU BAN ĐẦU (CHẶN ĐÁNH DẤU NEW CHO DỮ LIỆU TỪ NÃO NHỆN)
    const legacyCheckInterval = setInterval(() => {
        if (!isLegacyCleared && typeof folderDataCache !== 'undefined' && folderDataCache[ROOT_FOLDER_ID] && folderDataCache[ROOT_FOLDER_ID].length > 0) {
            // Lấy toàn bộ thư mục từ mẻ đồng bộ đầu tiên đưa vào danh sách "Đã Biết"
            folderDataCache[ROOT_FOLDER_ID].forEach(item => {
                if (item.type === 'folder' && !knownMegas.includes(item.id)) {
                    knownMegas.push(item.id);
                }
            });
            localStorage.setItem('vinhloc_known_megas', JSON.stringify(knownMegas));
            localStorage.setItem('vinhloc_legacy_megas_cleared', 'true');
            isLegacyCleared = true;
            
            clearInterval(legacyCheckInterval);
            console.log("🕷️ [Nhãn New] Đã thiết lập mốc dữ liệu Não Nhện. Các thư mục mới từ nay về sau sẽ có nhãn New.");
        }
    }, 2000);

    // 4. GHI ĐÈ HÀM RENDER ĐỂ GẮN NHÃN
    if (window.renderItems && !window.renderItems.isNewLabelPatched) {
        const originalRenderItems = window.renderItems;
        
        window.renderItems = function(items, isSearchMode = false) {
            // 4.1 Chạy hàm render gốc để HTML được sinh ra
            originalRenderItems(items, isSearchMode);

            // 4.2 Tìm các Mega-row để gắn nhãn (Chỉ gắn khi không ở chế độ tìm kiếm và đang ở trang chủ)
            if (isLegacyCleared && typeof folderStack !== 'undefined' && folderStack.length === 1 && !isSearchMode) {
                items.forEach(item => {
                    if (item.type === 'folder' && !knownMegas.includes(item.id)) {
                        // Xác minh đây thực sự là Mega-row gốc (nằm trong ROOT_FOLDER_ID)
                        const isMega = folderDataCache[ROOT_FOLDER_ID] && folderDataCache[ROOT_FOLDER_ID].some(i => i.id === item.id);
                        
                        if (isMega) {
                            const headerIcon = document.getElementById(`icon-${item.id}`);
                            if (headerIcon) {
                                const megaHeader = headerIcon.closest('.mega-header');
                                if (megaHeader) {
                                    // Bắt buộc set relative để ảnh con có thể position absolute theo thẻ này
                                    megaHeader.style.position = 'relative';
                                    
                                    if (!document.getElementById(`new-label-${item.id}`)) {
                                        const newLabel = document.createElement('img');
                                        newLabel.id = `new-label-${item.id}`;
                                        newLabel.src = 'new_folder.png'; // File ảnh nhãn New
                                        newLabel.className = 'mega-new-label-img';
                                        
                                        // Gắn vào trong mega-header
                                        megaHeader.appendChild(newLabel);
                                    }
                                }
                            }
                        }
                    }
                });
            }
        };
        window.renderItems.isNewLabelPatched = true;
    }

    // 5. GHI ĐÈ HÀM CLICK MỞ FOLDER (TẮT NHÃN NEW)
    if (window.toggleAccordion && !window.toggleAccordion.isNewLabelPatched) {
        const originalToggleAccordion = window.toggleAccordion;
        
        window.toggleAccordion = async function (id, forceOpen = false) {
            // Đánh dấu Mega-row này là đã xem
            if (!knownMegas.includes(id)) {
                knownMegas.push(id);
                localStorage.setItem('vinhloc_known_megas', JSON.stringify(knownMegas));
                
                // Tạo hiệu ứng mờ dần và xóa nhãn khỏi UI
                const label = document.getElementById(`new-label-${id}`);
                if (label) {
                    label.style.transition = 'all 0.3s ease';
                    label.style.opacity = '0';
                    label.style.transform = 'scale(0.5)';
                    setTimeout(() => label.remove(), 300);
                }
            }
            
            // Gọi hàm mở gốc
            return originalToggleAccordion(id, forceOpen);
        };
        window.toggleAccordion.isNewLabelPatched = true;
    }

    // Tự động làm mới UI 1 lần nếu đã có dữ liệu hiển thị sẵn trên màn hình
    if (typeof currentDriveItems !== 'undefined' && currentDriveItems.length > 0) {
        window.renderItems(currentDriveItems);
    }

    console.log("✅ PATCH 36: Đã kích hoạt hệ thống Nhãn New Folder thông minh cho Mega-row!");
}, 19500); // Chạy trễ nhất để bao bọc các bản vá cũ
// ==============================================================
// PATCH 37-38: FIX MENU HEADER BỊ CẮT & ĐỒNG BỘ THỨ TỰ TẠO FOLDER
// ==============================================================
setTimeout(() => {
    // ---------------------------------------------------------
    // 1. FIX LỖI MENU HEADER BỊ CẮT XÉN DO OVERFLOW & Z-INDEX
    // ---------------------------------------------------------
    const header = document.querySelector('header');
    if (header) {
        header.style.overflow = 'visible';  // Mở khóa để menu thả xuống không bị cắt
        header.style.position = 'relative'; 
        header.style.zIndex = '999999';     // Đè bẹp mọi z-index của Mega-row
    }
    
    const rightHeaderImg = document.querySelector('.vl-decor-header');
    if (rightHeaderImg) {
        rightHeaderImg.style.maxWidth = '100vw';
        rightHeaderImg.style.clipPath = 'inset(0 0 0 0)'; // Cắt viền ảnh mà không ảnh hưởng thẻ cha
    }

    const headerDropdownContainer = document.getElementById('headerDropdownContainer');
    if (headerDropdownContainer) headerDropdownContainer.style.zIndex = '9999999';
    
    const headerDropdown = document.getElementById('headerDropdown');
    if (headerDropdown) headerDropdown.style.zIndex = '9999999';

    // ---------------------------------------------------------
    // 2. FIX THỨ TỰ SẮP XẾP KHI TẠO THƯ MỤC MỚI (CHỐNG LỖI NHÂN BẢN)
    // ---------------------------------------------------------
    window.uiPromptFolder = function (targetParentId = null, e = null) {
        if (e) { e.stopPropagation(); document.querySelectorAll('.item-action-menu').forEach(menu => menu.classList.add('hidden')); }
        if (typeof closeFab === 'function') closeFab();

        document.getElementById('modalTitle').textContent = 'Thư mục mới';
        document.getElementById('modalDesc').classList.add('hidden');
        document.getElementById('modalInput').classList.remove('hidden');
        document.getElementById('modalInput').value = '';
        document.getElementById('modalInput').placeholder = "Nhập tên thư mục...";

        const btn = document.getElementById('modalConfirmBtn');
        btn.textContent = 'Tạo'; 
        btn.className = 'px-5 py-2 bg-blue-600 text-white font-bold rounded-xl';

        btn.onclick = () => {
            const val = document.getElementById('modalInput').value.trim();
            if (val) {
                const parentIdToUse = (targetParentId && typeof targetParentId === 'string') ? targetParentId : currentFolderId;
                closeModal();

                const isMegaRow = (parentIdToUse === ROOT_FOLDER_ID);
                const tempId = 'temp_folder_' + Date.now();
                const newItem = { id: tempId, name: val, type: 'folder', isPending: true };

                let targetCategory = "Triển khai"; 
                let targetDesc = ""; 

                if (isMegaRow) {
                    targetCategory = window.currentCategory || "Triển khai";
                    targetDesc = `[${targetCategory}]\n`;
                    
                    appMeta[tempId] = { type: targetCategory, desc: '', cover: '', name: val };
                    localforage.setItem('vinhloc_meta', appMeta).catch(()=>{});
                }

                // Hàm sắp xếp chuẩn theo thứ tự chữ cái giống hệt Server (Drive)
                const sortAlphabetically = (arr) => {
                    arr.sort((a, b) => {
                        if (a.type === b.type) return (a.name || '').localeCompare(b.name || '');
                        return a.type === 'folder' ? -1 : 1;
                    });
                };

                // A. HIỂN THỊ TỨC THÌ LÊN GIAO DIỆN VỚI ĐÚNG VỊ TRÍ ALPHABET
                if (parentIdToUse === currentFolderId) {
                    currentDriveItems.push(newItem);
                    sortAlphabetically(currentDriveItems); // Sắp xếp lại ngay lập tức thay vì đưa lên đầu (unshift)
                    folderDataCache[currentFolderId] = currentDriveItems;
                    window.renderItems(currentDriveItems);
                } else if (subFolderCache[parentIdToUse]) {
                    subFolderCache[parentIdToUse].push(newItem);
                    sortAlphabetically(subFolderCache[parentIdToUse]); // Sắp xếp lại ngay lập tức
                    if (typeof window.renderSubFolders === 'function') window.renderSubFolders(parentIdToUse, subFolderCache[parentIdToUse]);
                }

                showToast(`<i class="fas fa-check mr-2"></i> Đã tạo mục "${val}"`);

                // B. ĐẨY LỆNH VÀO QUEUE CHO SERVER
                addActionToQueue('createFolder', {
                    name: val,
                    folderId: parentIdToUse,
                    tempId: tempId,
                    description: targetDesc,
                    isMegaRow: isMegaRow,       
                    category: targetCategory    
                });
            }
        };
        document.getElementById('customModal').classList.remove('hidden'); document.getElementById('customModal').classList.add('flex');
        setTimeout(() => document.getElementById('modalInput').focus(), 100);
    };

    console.log("✅ PATCH 37-38: Đã fix Menu Header bị cắt và Đồng bộ đúng thứ tự Alphabet khi tạo thư mục!");
}, 21000); // Khởi chạy ở mốc 21s để đảm bảo đè thành công các bản cũ

