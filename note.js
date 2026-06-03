// ==============================================================
// PATCH 55: SAO CHÉP / DI CHUYỂN TOÀN CỤC VÀ ĐÍCH DÁN (ĐÃ SỬA LỖI NHÂN ĐÔI FILE MỜ)
// ==============================================================
setTimeout(() => {
    // 1. Chèn mục "Đích dán" vào Menu Header đảm bảo hiển thị đúng
    if (window.buildHeaderMenu && !window.buildHeaderMenu.isPatched55) {
        const originalBuildHeaderMenu = window.buildHeaderMenu;
        window.buildHeaderMenu = function() {
            originalBuildHeaderMenu(); 
            const headerDropdown = document.getElementById('headerDropdown');
            if (headerDropdown) {
                const pasteDestHtml = `<div class="px-5 py-3 hover:bg-green-50 cursor-pointer flex items-center justify-between transition font-medium border-t border-gray-50" onclick="window.markPasteDestination()"><span><i class="fas fa-bullseye mr-2 text-green-600"></i> Đích dán</span></div>`;
                headerDropdown.insertAdjacentHTML('beforeend', pasteDestHtml);
            }
        };
        window.buildHeaderMenu.isPatched55 = true;
    }

    // 2. Logic lưu trữ đường dẫn và ID đích dán
    window.targetPasteFolderId = null;
    window.targetPasteFolderPath = '';

    window.markPasteDestination = function() {
        if (!currentFolderId || currentFolderId === 'dummy_design_state') {
            return showToast("Không thể chọn đích dán tại đây!", true);
        }
        window.targetPasteFolderId = currentFolderId;
        // Bóc tách đường dẫn từ Header (Triển khai > Ý tưởng...)
        window.targetPasteFolderPath = folderStack.map(f => f.name).join(' > ');
        
        showToast('<i class="fas fa-check-circle mr-2 text-green-400"></i> Đã đánh dấu thành thư mục cần dán sao chép và di chuyển');
        
        // Ẩn Menu Header
        const menu = document.getElementById('headerDropdown');
        if (menu) menu.classList.add('hidden');
        
        // Hiệu ứng nảy bật ra cho Nút Copy/Cut
        const btnCopyCut = document.getElementById('btn-copy-cut');
        if (btnCopyCut) {
            btnCopyCut.classList.remove('hidden');
            btnCopyCut.style.transform = 'scale(0)';
            setTimeout(() => {
                btnCopyCut.style.transition = 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                btnCopyCut.style.transform = 'scale(1)';
            }, 50);
        }
        
        // Mồi sẵn đường dẫn vào input nếu đang mở
        const destInput = document.getElementById('destPathInput');
        if (destInput) destInput.value = window.targetPasteFolderPath;
    };

    // 3. Logic điều khiển Popup Sao chép / Di chuyển
    const btnCopyCut = document.getElementById('btn-copy-cut');
    const copyMoveModal = document.getElementById('copyMoveModal');
    const destInput = document.getElementById('destPathInput');
    const btnClearDest = document.getElementById('btnClearDest');
    const btnDoCopy = document.getElementById('btnDoCopy');
    const btnDoMove = document.getElementById('btnDoMove');
    const btnDoDone = document.getElementById('btnDoDone');

    if (btnCopyCut && copyMoveModal) {
        btnCopyCut.addEventListener('click', () => {
            destInput.value = window.targetPasteFolderPath || '';
            copyMoveModal.classList.remove('hidden');
            copyMoveModal.classList.add('flex');
            
            const box = document.getElementById('copyMoveBox');
            if(box) {
                box.style.transform = 'scale(0.95)';
                setTimeout(() => box.style.transform = 'scale(1)', 50);
            }
        });

        copyMoveModal.addEventListener('click', (e) => {
            if (e.target === copyMoveModal) {
                copyMoveModal.classList.add('hidden');
                copyMoveModal.classList.remove('flex');
            }
        });

        btnClearDest.addEventListener('click', () => {
            window.targetPasteFolderId = null;
            window.targetPasteFolderPath = '';
            destInput.value = '';
            btnCopyCut.classList.add('hidden'); 
        });

        btnDoDone.addEventListener('click', () => {
            window.targetPasteFolderId = null;
            window.targetPasteFolderPath = '';
            destInput.value = '';
            copyMoveModal.classList.add('hidden');
            copyMoveModal.classList.remove('flex');
            btnCopyCut.classList.add('hidden');
            
            if (window.multiSelectState) {
                window.multiSelectState.selectedIds.clear();
            }
            window.renderItems(currentDriveItems); // Bỏ chọn, giữ nguyên vị trí
        });

        const executeOp = async (mode) => {
            if (!window.targetPasteFolderId) return showToast("Chưa chọn đích dán!", true);
            if (!window.multiSelectState || window.multiSelectState.selectedIds.size === 0) {
                return showToast("Chưa chọn file/folder nào để thao tác!", true);
            }
            
            let idsToProcess = Array.from(window.multiSelectState.selectedIds);
            let itemsToProcess = [];
            const allItems = [...currentDriveItems, ...Object.values(folderDataCache).flat(), ...Object.values(subFolderCache).flat()];
            const uniqueItems = Array.from(new Map(allItems.map(item => [item.id, item])).values());
            
            let numFiles = 0; let numFolders = 0;
            
            for (let id of idsToProcess) {
                let item = uniqueItems.find(i => i.id === id);
                if (item) {
                    itemsToProcess.push({
                        id: item.id, type: item.type,
                        origParent: currentFolderId, 
                        itemRef: item 
                    });
                    if (item.type === 'folder') numFolders++; else numFiles++;
                }
            }
            if (itemsToProcess.length === 0) return;
            
            showToast(`<i class="fas fa-spinner fa-spin mr-2"></i> Đang ${mode === 'copy' ? 'sao chép' : 'di chuyển'}...`);
            
            // --- GIAO DIỆN LẠC QUAN ---
            let tempItems = [];
            itemsToProcess.forEach(obj => {
                let tempItem = JSON.parse(JSON.stringify(obj.itemRef));
                tempItem.id = 'temp_' + mode + '_' + Date.now() + Math.random();
                tempItem.isPending = true; 
                if (mode === 'copy') tempItem.name = "Bản sao của " + tempItem.name;
                
                if (tempItem.type !== 'folder') {
                    tempItem.tempUrl = tempItem.tempUrl || `https://drive.google.com/thumbnail?id=${obj.itemRef.id}&sz=w400`;
                }
                tempItems.push(tempItem);
            });
            
            if (currentFolderId === window.targetPasteFolderId) {
                currentDriveItems = [...tempItems, ...currentDriveItems];
                folderDataCache[currentFolderId] = currentDriveItems;
                window.renderItems(currentDriveItems);
                
                tempItems.forEach(tempItem => {
                    if(tempItem.type === 'folder') {
                        let nameEl = document.querySelector(`.item-name-${tempItem.id}`);
                        if (nameEl) {
                            let row = nameEl.closest('.subfolder-row');
                            if (row) {
                                row.style.opacity = '0.5';
                                row.style.pointerEvents = 'none';
                                nameEl.innerHTML = `<i class="fas fa-spinner fa-spin mr-1 text-blue-500"></i> ` + nameEl.innerHTML;
                            }
                        }
                    }
                });
            } else if (folderDataCache[window.targetPasteFolderId]) {
                folderDataCache[window.targetPasteFolderId] = [...tempItems, ...folderDataCache[window.targetPasteFolderId]];
            }
            
            // Nếu di chuyển, ẩn file lạc quan ở thư mục cũ
            if (mode === 'move') {
                Object.keys(folderDataCache).forEach(fId => {
                    if (fId !== window.targetPasteFolderId) {
                         folderDataCache[fId] = folderDataCache[fId].filter(i => !idsToProcess.includes(i.id));
                         if (fId === currentFolderId) currentDriveItems = folderDataCache[fId];
                    }
                });
                if (currentFolderId !== window.targetPasteFolderId) window.renderItems(currentDriveItems);
            }

            try {
                const payload = {
                    mode: mode,
                    targetFolderId: window.targetPasteFolderId,
                    items: itemsToProcess.map(i => ({id: i.id, type: i.type, origParent: i.origParent}))
                };
                
                syncQueueCount++; updateSyncIndicator();
                const res = await fetch(SCRIPT_URL, {
                    method: 'POST', body: JSON.stringify({ action: 'clipboardOps', ...payload })
                }).then(r => r.json());
                
                if (res && res.success) {
                    showToast(`<i class="fas fa-check mr-2 text-green-400"></i> ${mode === 'copy' ? 'Sao chép' : 'Di chuyển'} thành công ${numFolders} folder, ${numFiles} file`);
                    
                    // ==========================================
                    // SỬA LỖI TẠI ĐÂY: XÓA CÁC FILE MỜ TẠM THỜI
                    // ==========================================
                    let tempIds = tempItems.map(t => t.id);
                    
                    // Xóa trong cache đích đến
                    if (folderDataCache[window.targetPasteFolderId]) {
                        folderDataCache[window.targetPasteFolderId] = folderDataCache[window.targetPasteFolderId].filter(i => !tempIds.includes(i.id));
                    }

                    // Nếu user đang đứng ở đích đến, xóa trên UI luôn
                    if (currentFolderId === window.targetPasteFolderId) {
                        currentDriveItems = currentDriveItems.filter(i => !tempIds.includes(i.id));
                        folderDataCache[currentFolderId] = currentDriveItems;
                        window.renderItems(currentDriveItems);
                    }

                    // Gọi tải lại dữ liệu thật (không mờ) từ thư mục đích về
                    if (window.fetchDriveData) {
                        window.fetchDriveData(window.targetPasteFolderId, true);
                    }

                } else {
                    showToast(`Lỗi: ${res.message || 'Hệ thống gián đoạn'}`, true);
                    // Rớt mạng thì Undo trả lại trạng thái
                    if (currentFolderId === window.targetPasteFolderId) {
                        currentDriveItems = currentDriveItems.filter(i => !i.id.startsWith('temp_'));
                        folderDataCache[currentFolderId] = currentDriveItems;
                        window.renderItems(currentDriveItems);
                    }
                }
            } catch (err) {
                showToast(`Lỗi mạng: ${err.message}`, true);
            } finally {
                syncQueueCount--; updateSyncIndicator();
            }
        };

        // Gỡ listener cũ nếu lỡ click nhiều lần (phòng ngừa)
        const oldDoCopy = btnDoCopy.cloneNode(true);
        const oldDoMove = btnDoMove.cloneNode(true);
        btnDoCopy.parentNode.replaceChild(oldDoCopy, btnDoCopy);
        btnDoMove.parentNode.replaceChild(oldDoMove, btnDoMove);

        oldDoCopy.addEventListener('click', () => executeOp('copy'));
        oldDoMove.addEventListener('click', () => executeOp('move'));
    }
}, 1200);
