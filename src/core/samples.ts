export const RASGAP_SAMPLE = String.raw`## Concept: Isolating RasGAP's Specific Role

- To prove p120RasGAP is the key to invasion, researchers used the **SW480** colon cancer cell line.
- **Knockdown:** Depleting RasGAP $\rightarrow$ dramatically decreased tumor invasion and c-Src activation.
- **Rescue:** Giving the cells an artificial GFP-RasGAP $\rightarrow$ fully rescued (restored) tumor invasion.
- **The Crucial Detail:** Knocking down RasGAP had **zero effect** on general cell proliferation, survival, or soft agar growth.
  - *Meaning:* The Ras $\rightarrow$ p120RasGAP $\rightarrow$ c-Src pathway is a highly specialized "weapon" used *exclusively* for cancer invasion and metastasis.
`;

export const SCIENCE_SAMPLE = String.raw`# Small signals. Big discoveries.

## Following the Ras pathway

Biology is a story of connections. A small molecular signal can set an entire cellular process in motion.

**The pathway:** Ras $\rightarrow$ p120RasGAP $\rightarrow$ c-Src

- **Knockdown:** Depleting RasGAP dramatically decreased tumor invasion.
- **Rescue:** Artificial GFP-RasGAP restored the invasive behavior.
- **The key detail:** Cell proliferation remained **unchanged**.
  - *Meaning:* This pathway has a specific role in invasion, rather than general cell growth.

## A little chemistry

Photosynthesis converts light into chemical energy:

$$
\ce{6CO2 + 6H2O ->[light] C6H12O6 + 6O2}
$$

## Putting numbers to it

Enzyme kinetics can be described by the Michaelis–Menten equation:

$$
v = \frac{V_{\max}[S]}{K_m + [S]}
$$

| Symbol | Meaning |
| :--- | :--- |
| $v$ | Reaction velocity |
| $V_{\max}$ | Maximum reaction velocity |
| $K_m$ | Michaelis constant |

> **Remember:** Clear notation makes complex ideas easier to understand.

বাংলায় নোট: প্রতিটি সংকেত গুরুত্বপূর্ণ।
`;

export const EDGE_CASE_SAMPLE = String.raw`# Scientific notation test sheet

Inline: \(\alpha + \beta \leq \gamma\), $\frac{a+b}{c+d}$, $x_i^2$, and 37 °C.

\[
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
\]

$$
\begin{aligned}
f(x) &= \begin{cases}x^2 & x \geq 0 \\ -x & x < 0\end{cases} \\
I &= \int_0^1 x^2\,dx = \frac{1}{3}
\end{aligned}
$$

Chemistry: $\ce{SO4^2-}$, $\ce{^{14}C}$, $\ce{A <=> B}$, $\pu{5.0 mol L-1}$.

Currency stays currency: $5 and $10; escaped: \$25. A literal \n stays literal.

Code stays code: \`$\rightarrow$\` and \`C:\new\notes\`.

| Equation | Meaning |
| --- | --- |
| $\sum_{i=1}^{n} i$ | A finite sum |
| $\sqrt{a^2+b^2}$ | A square root |

English, বাংলা, αβγ, H₂O, Ca²⁺, → ⇌ ≤ ≥ ± × µ.

1. A numbered item.
   - A nested bullet with **bold** and *italic*.
2. A second item with a footnote.[^note]

[^note]: Keep the source and its meaning intact.
`;
