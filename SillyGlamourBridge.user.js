// ==UserScript==
// @name         SillyGlamourBridge
// @namespace    SillyGlamourBridge
// @version      0.3.2
// @author       u86cd
// @description  為SillyToolbox準備的幻化複製腳本
// @license      MIT
// @match        https://ffxiv.eorzeacollection.com/glamour/*
// @match        https://ff14risingstones.web.sdo.com/pc/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const button_id = 'silly-glamour-bridge-copy';
    const button_text = '複製整套配方';
    const schema_name = 'sillytoolbox.eorzea-collection-glamour';
    const reset_delay = 2000;
    const stone_host = 'ff14risingstones.web.sdo.com';
    const stone_route = /^#\/glamour\/detail\/\d+\/?$/u;
    const empty_dye_names = new Set(['不可染色', '未染色', '无染色', '無染色']);
    const stone_slots = new Map([
        ['主手', 'MAIN HAND'],
        ['副手', 'OFF HAND'],
        ['头部', 'HEAD'],
        ['上衣', 'BODY'],
        ['手部', 'HANDS'],
        ['腿部', 'LEGS'],
        ['脚部', 'FEET'],
        ['耳坠', 'EARRINGS'],
        ['项链', 'NECKLACE'],
        ['手镯', 'BRACELETS'],
    ]);

    function clean_text(text) {
        return text?.replace(/\s+/gu, ' ').trim() || '';
    }

    function find_ec_divider() {
        return [...document.querySelectorAll('.divider')]
            .find((node) => node.textContent.trim() === 'Equipment');
    }

    function read_ec_dyes(row_node) {
        const dye_names = [...row_node.querySelectorAll('.list-item-description .tag')]
            .map((tag_node) => clean_text(tag_node.textContent))
            .filter((tag_text) => /^[⬤◯]/u.test(tag_text))
            .map((tag_text) => {
                const dye_name = tag_text.replace(/^[⬤◯]\s*/u, '');
                return dye_name === 'Undyed' ? null : dye_name;
            });

        if (dye_names.length > 2) {
            throw new Error('染色欄位超過兩個');
        }

        return [dye_names[0] ?? null, dye_names[1] ?? null];
    }

    function parse_ec_row(row_node) {
        const slot_node = row_node.querySelector('.gear-icon-box-slot-name');
        const slot_name = slot_node?.textContent.trim().toUpperCase();
        const item_node = row_node.querySelector('.list-item-title');
        const item_name = clean_text(item_node?.textContent) || null;
        const dye_names = read_ec_dyes(row_node);

        if (!slot_name) {
            throw new Error('裝備部位為空');
        }

        if (item_name === null && dye_names.some((dye_name) => dye_name !== null)) {
            throw new Error(`${slot_name} 沒有裝備但包含染色`);
        }

        return { slot: slot_name, item: item_name, dyes: dye_names };
    }

    function read_ec_rows(divider_node) {
        const row_nodes = [];
        let next_node = divider_node.nextElementSibling;

        while (next_node?.matches('.list.box')) {
            row_nodes.push(next_node);
            next_node = next_node.nextElementSibling;
        }

        if (row_nodes.length === 0) {
            throw new Error('找不到裝備資料');
        }

        return row_nodes.map(parse_ec_row);
    }

    function read_ec_section(section_name) {
        const heading_text = `— ${section_name} —`;
        const heading_node = [...document.querySelectorAll('h2')]
            .find((node) => clean_text(node.textContent) === heading_text);
        const row_nodes = [];
        let next_node = heading_node?.nextElementSibling;

        while (next_node?.matches('.list.box')) {
            row_nodes.push(next_node);
            next_node = next_node.nextElementSibling;
        }

        return row_nodes;
    }

    function read_ec_accessories() {
        const valid_slots = new Set(['EARRINGS', 'NECKLACE', 'BRACELETS']);
        let ring_count = 0;

        return read_ec_section('Accessories').map((row_node) => {
            const row = parse_ec_row(row_node);
            if (row.slot === 'RING') {
                ring_count += 1;
                if (ring_count > 2) {
                    throw new Error('戒指部位超過兩個');
                }

                return { ...row, slot: ring_count === 1 ? 'RIGHT RING' : 'LEFT RING' };
            }

            if (!valid_slots.has(row.slot)) {
                throw new Error(`不支援的飾品部位：${row.slot}`);
            }

            return row;
        });
    }

    function read_ec_face() {
        const row_node = read_ec_section('Fashion Accessories')
            .find((node) => clean_text(node.querySelector('.gear-icon-box-slot-name')?.textContent) === 'FACE');
        return row_node ? parse_ec_row(row_node) : null;
    }

    function build_ec_payload() {
        const divider_node = find_ec_divider();
        const title_node = document.querySelector('h1.title.has-negative-letter-spacing');
        const author_node = document.querySelector('a[href^="/creator/"] h3.title.is-5');

        if (!divider_node) {
            throw new Error('找不到 Equipment 區段');
        }

        const equipment = [...read_ec_rows(divider_node), ...read_ec_accessories()];
        const face_row = read_ec_face();
        if (face_row) {
            equipment.push(face_row);
        }

        const source_url = `${location.origin}${location.pathname}`;
        return make_payload(
            source_url,
            clean_text(title_node?.textContent),
            clean_text(author_node?.textContent) || null,
            equipment,
        );
    }

    function find_stone_parts() {
        return document.querySelector('.detail__info___right .info__parts:not(.is-accessory)');
    }

    function read_stone_dyes(row_node) {
        const dye_node = row_node.querySelector('.part__info___dye');
        if (!dye_node || dye_node.classList.contains('is-disabled')) {
            return [null, null];
        }

        const dye_names = [...dye_node.querySelectorAll('.info__dye___item')]
            .map((item_node) => clean_text(item_node.textContent))
            .map((dye_name) => empty_dye_names.has(dye_name) ? null : dye_name);

        if (dye_names.length > 2) {
            throw new Error('染色欄位超過兩個');
        }

        return [dye_names[0] ?? null, dye_names[1] ?? null];
    }

    function parse_stone_row(row_node, slot_name, slot_text) {
        const item_name = clean_text(row_node.querySelector('.part__info___name')?.textContent) || null;
        const dye_names = read_stone_dyes(row_node);

        if (item_name === null && dye_names.some((dye_name) => dye_name !== null)) {
            throw new Error(`${slot_text} 沒有裝備但包含染色`);
        }

        return { slot: slot_name, item: item_name, dyes: dye_names };
    }

    function read_stone_rows(parts_node) {
        const row_nodes = [...parts_node.querySelectorAll(':scope > .glamour__part')];
        const equipment = [];
        let ring_count = 0;

        if (row_nodes.length === 0) {
            throw new Error('找不到裝備資料');
        }

        for (const row_node of row_nodes) {
            const slot_text = clean_text(row_node.querySelector('.glamour__part___name')?.textContent);
            let slot_name = stone_slots.get(slot_text);

            if (slot_text === '戒指') {
                ring_count += 1;
                slot_name = ring_count === 1 ? 'RIGHT RING' : 'LEFT RING';
            }

            if (!slot_name || ring_count > 2) {
                throw new Error(`不支援的裝備部位：${slot_text || '空白'}`);
            }

            const row = parse_stone_row(row_node, slot_name, slot_text);

            if (row.item === null && (slot_name === 'MAIN HAND' || slot_name === 'OFF HAND')) {
                continue;
            }

            equipment.push(row);
        }

        return equipment;
    }

    function read_stone_face() {
        const row_node = [...document.querySelectorAll(
            '.detail__info___right .info__parts.is-accessory > .glamour__part',
        )].find((node) => clean_text(node.querySelector('.glamour__part___name')?.textContent) === '面部配饰');
        return row_node ? parse_stone_row(row_node, 'FACE', '面部配饰') : null;
    }

    function build_stone_payload() {
        const parts_node = find_stone_parts();
        const title_node = document.querySelector('.detail__info___right .info__title');
        const author_node = document.querySelector('.info__character___name');

        if (!stone_route.test(location.hash)) {
            throw new Error('目前不是石之家幻化詳情頁');
        }

        if (!parts_node) {
            throw new Error('找不到石之家裝備區段');
        }

        const equipment = read_stone_rows(parts_node);
        const face_row = read_stone_face();
        if (face_row) {
            equipment.push(face_row);
        }

        const source_url = `${location.origin}${location.pathname}${location.hash}`;
        return make_payload(
            source_url,
            clean_text(title_node?.textContent),
            clean_text(author_node?.textContent) || null,
            equipment,
        );
    }

    function make_payload(source_url, title, author, equipment) {
        if (!title) {
            throw new Error('找不到幻化標題');
        }

        if (equipment.length === 0 || equipment.length > 13) {
            throw new Error('裝備部位數量必須介於一至十三個');
        }

        const slot_names = new Set();
        for (const row of equipment) {
            if (slot_names.has(row.slot)) {
                throw new Error(`裝備部位重複：${row.slot}`);
            }

            slot_names.add(row.slot);
        }

        return {
            schema: schema_name,
            version: 1,
            sourceUrl: source_url,
            title,
            author,
            equipment,
        };
    }

    function set_button_state(button_node, text, detail = '') {
        button_node.textContent = text;
        button_node.title = detail;
    }

    function copy_payload(button_node) {
        try {
            const payload = button_node.dataset.site === 'stone'
                ? build_stone_payload()
                : build_ec_payload();
            GM_setClipboard(JSON.stringify(payload));
            set_button_state(button_node, '已複製');
        } catch (error) {
            const error_text = error instanceof Error ? error.message : String(error);
            console.error('[SillyGlamourBridge]', error);
            set_button_state(button_node, '複製失敗', error_text);
        }

        window.setTimeout(() => set_button_state(button_node, button_text), reset_delay);
    }

    function make_button(site_name) {
        const button_node = document.createElement('button');
        button_node.id = button_id;
        button_node.type = 'button';
        button_node.dataset.site = site_name;

        if (site_name === 'stone') {
            button_node.className = 'el-button el-button--primary';
            button_node.style.width = '100%';
            button_node.style.margin = '10px 0';
        } else {
            button_node.className = 'button is-primary is-fullwidth mb-2';
        }

        set_button_state(button_node, button_text);
        button_node.addEventListener('click', () => copy_payload(button_node));
        return button_node;
    }

    function find_site() {
        if (stone_route.test(location.hash) && find_stone_parts()) {
            return 'stone';
        }

        return find_ec_divider() ? 'ec' : null;
    }

    function init_bridge() {
        const site_name = find_site();
        const old_button = document.getElementById(button_id);

        if (!site_name) {
            old_button?.remove();
            return;
        }

        if (old_button?.dataset.site === site_name) {
            return;
        }

        old_button?.remove();
        const anchor_node = site_name === 'stone' ? find_stone_parts() : find_ec_divider();
        anchor_node?.before(make_button(site_name));
    }

    init_bridge();

    if (location.hostname === stone_host || stone_route.test(location.hash)) {
        const page_observer = new MutationObserver(init_bridge);
        page_observer.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('hashchange', init_bridge);
    }
})();
