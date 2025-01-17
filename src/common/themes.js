/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2023 Giorgio Maone <https://maone.net>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 */

{
  const PARENT_CLASS = "__NoScript_Theme__";
  let patchSheet = s => {
    const PARENT_SELECTOR = `.${PARENT_CLASS}`;
    let rules = s.cssRules;
    for (let j = 0, len = rules.length; j < len; j++) {
      let rule = rules[j];
      if (rule.styleSheet && patchSheet(rule.styleSheet)) {
        return true;
      }
      if (rule.conditionText !== "(prefers-color-scheme: light)") continue;
      for (let r of rule.cssRules) {
        let {selectorText} = r;
        if (selectorText.includes("[data-theme=") || !selectorText.startsWith(PARENT_SELECTOR)) continue;
        selectorText = selectorText.replace(PARENT_SELECTOR, `${PARENT_SELECTOR}[data-theme="light"]`);
        s.insertRule(`${selectorText} {${r.style.cssText}}`, j);
      }
      return true;
    }
    return false;
  }

  let patchAll = () => {
    for (let s of document.styleSheets) {
      try {
        if (patchSheet(s)) return true;
      } catch (e) {
        // cross-site stylesheet?
        console.error(e, s.href);
      }
    }
    return false;
  }

  if (!patchAll()) {
    console.error("Couldn't patch sheets while loading, deferring to onload");
    let onload = e => {
      if (patchAll()) {
        removeEventListener(e.type, onload, true);
      }
    }
    addEventListener("load", onload, true);
  }

  let contentCSS;

  let root = document.documentElement;
  root.classList.add(PARENT_CLASS);

  const VINTAGE = "vintageTheme";

  let update = toTheme => {
    if (window.localStorage) try {
      localStorage.setItem("theme", toTheme);
    } catch (e) {}
    return root.dataset.theme = toTheme;
  }

  let updateFavIcon = isVintage => {
    let favIcon = document.querySelector("link[rel=icon]");
    if (!favIcon) return;
    let {href} = favIcon;
    const BASE = new URL("/img/", location.href);
    if (!href.startsWith(BASE)) return alert("return");
    const SUB = BASE + "vintage/";
    let vintageIcon = href.startsWith(SUB);
    if (isVintage === vintageIcon) return;
    favIcon.href = isVintage ? href.replace(BASE, SUB) : href.replace(SUB, BASE);
  }

  let refreshVintage = isVintage => {
    if (localStorage) try {
      localStorage.setItem(VINTAGE, isVintage || "");
    } catch (e) {}
    document.documentElement.classList.toggle("vintage", isVintage === true);
    if (browser.browserAction) {
      browser.browserAction.setIcon({path: {64: `/img${isVintage ? "/vintage/" : "/"}ui-maybe64.png` }});
    }
    updateFavIcon(isVintage);
  }

  const THEMES = ["dark", "light", "auto"];
  var Themes = {
    VINTAGE,
    setup(theme = null) {
      if (theme) {
        if (browser && browser.storage) {
          browser.storage.local.set({theme});
        }
      } else {
        if (localStorage) {
          theme = localStorage.getItem("theme");
          if (!THEMES.includes(theme)) theme = null;
        }
        if (!theme && browser && browser.storage) {
          if (document.readyState === "loading") {
            document.documentElement.style.visibility = "hidden";
          }
          return browser.storage.local.get(["theme"]).then(({theme}) => {
              update(theme);
              document.documentElement.style.visibility = "";
              return theme || "auto";
          });
        }
      }
      return update(theme);
    },

    async isVintage() {
      let ret;
      if (localStorage) {
        ret = localStorage.getItem(VINTAGE);
        if (ret !== null) return !(ret === "false" || !ret);
      }
      ret = (await browser.storage.local.get([VINTAGE]))[VINTAGE];
      return ret;
    },

    async setVintage(b) {
      refreshVintage(b);
      await browser.storage.local.set({[VINTAGE]: b});
      return b;
    },

    async getContentCSS() {
      contentCSS = contentCSS || (async () => {
        const replaceAsync = async (string, regexp, replacerFunction) => {
          const replacements = await Promise.all(
              Array.from(string.matchAll(regexp),
                  match => replacerFunction(...match)));
          let i = 0;
          return string.replace(regexp, () => replacements[i++]);
        }
        const fetchAsDataURL = async (url) => {
          const blob = await (await fetch(browser.runtime.getURL(url))).blob();
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
              resolve(reader.result);
            };
            reader.onerror = e => {
              reject(reader.error);
            };
            reader.readAsDataURL(blob);
          });
        }
        const fetchAsText = async (url) => await (await fetch(browser.runtime.getURL(url))).text();

        const themesCSS = (await replaceAsync(await fetchAsText("/common/themes.css"),
            /(--img-logo:.*url\("?)(.*\.svg)"?/g,
            async (s, prop, url) => `${prop}"${await fetchAsDataURL(url)}"`
          ))
          .replace(/.*\burl\(\.*\/.*\n/g, '')
          .replace(/\/\*[^]*?\*\//g, '')
          .replace(/\n+/g, "\n");
        return (await fetchAsText("/content/content.css"))
          .replace(/\b(THEMES_START\b.*\n)[^]*(\n.*\bTHEMES_END)\b/g,
                  `$1${themesCSS}$2`);
      })();
      return await contentCSS;
    }
  };

  (async () => {
    refreshVintage(await Themes.isVintage());
  })();
  Promise.resolve(Themes.setup());

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const ifChanged = (key, callback) => {
      if (key in changes) {
        let {oldValue, newValue} = changes[key];
        if (oldValue !== newValue) {
          callback(newValue);
          window.dispatchEvent(new CustomEvent("NoScriptThemeChanged", {detail: {[key]: newValue}}));
        }
      }
    }
    ifChanged("theme", update);
    ifChanged(VINTAGE, refreshVintage);
  });
}