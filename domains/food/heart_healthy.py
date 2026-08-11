"""
Heart-healthy (cholesterol-lowering) meal guidance.

General, well-established dietary guidance for elevated LDL / non-HDL cholesterol:
favour soluble fibre (oats, barley, legumes, fruit), swap saturated fats
(butter, fatty/processed meat, pastries, cheese) for unsaturated ones (olive oil,
nuts, avocado, oily fish), and cut processed/fried food. Mediterranean-leaning and
compatible with the app's lean, high-protein training diet.

This is not medical advice — it complements, not replaces, the user's clinician.
"""

import hashlib
from typing import Optional

# Curated, cholesterol-friendly ideas. Each: name, kcal (approx), fibre_g, why.
_BREAKFAST = [
    ("Overnight oats with berries, walnuts & chia", 380, 9, "Oats' beta-glucan is soluble fibre that lowers LDL; walnuts & chia add unsaturated fats."),
    ("Wholegrain toast with avocado, tomato & olive oil", 330, 8, "Swaps butter for heart-healthy monounsaturated fats; wholegrain adds fibre."),
    ("Low-fat Greek yogurt with oats, grated apple & cinnamon", 300, 7, "Apple pectin + oats are soluble fibre; lean protein, no added saturated fat."),
    ("Veggie scramble (1 yolk + whites) with wholegrain bread", 340, 6, "Keeps dietary cholesterol modest while loading fibre and veg."),
]
_LUNCH = [
    ("Lentil & vegetable stew (lentejas)", 450, 15, "Legumes are the top soluble-fibre food for cutting LDL — filling and lean."),
    ("Chickpea & spinach stew (garbanzos con espinacas)", 430, 12, "Legume fibre + iron-rich greens, cooked in olive oil not lard."),
    ("Grilled salmon with quinoa & roasted veg", 520, 8, "Oily fish omega-3s and unsaturated fat in place of saturated."),
    ("Big salad: chickpeas, tuna, olive oil, seeds & veg", 430, 11, "Cold-plate fibre bomb with unsaturated fats and lean protein."),
    ("Wholegrain pasta with tomato, tuna & lots of veg", 480, 9, "Wholegrain over white for fibre; tuna keeps it lean."),
]
_DINNER = [
    ("Grilled white fish (merluza) with sweet potato & greens", 420, 7, "Lean protein, no saturated fat; sweet potato adds fibre."),
    ("Baked sardines/mackerel with roasted vegetables", 440, 6, "Oily fish twice a week is a core cholesterol move."),
    ("Vegetable & white-bean minestrone + wholegrain bread", 380, 13, "Beans and veg for soluble fibre; light and warming."),
    ("Grilled chicken breast with quinoa tabbouleh & salad", 470, 8, "Lean protein with a herb-and-grain fibre base."),
    ("Tofu & vegetable stir-fry with brown rice", 440, 9, "Plant protein, no saturated fat, brown rice for fibre."),
]
_SNACK = [
    ("Apple or pear + a small handful of unsalted almonds", 200, 5, "Fruit pectin + nut unsaturated fats — a proven LDL-friendly snack."),
    ("Carrot & cucumber sticks with hummus", 170, 6, "Legume-based dip and raw veg fibre instead of crisps."),
    ("Orange + a few walnuts", 180, 4, "Vitamin-C fruit fibre with omega-3-rich walnuts."),
    ("Low-fat Greek yogurt with berries", 150, 4, "Lean protein snack, berry fibre, no saturated fat."),
]

TIPS = [
    "Favour soluble fibre — oats, barley, beans, lentils, apples, citrus — it binds cholesterol in the gut.",
    "Swap saturated fats (butter, fatty & processed meat, pastries, cheese) for olive oil, nuts and avocado.",
    "Eat oily fish (salmon, sardines, mackerel) about twice a week for omega-3s.",
    "Cut processed & fried foods and bakery pastries — they're the biggest saturated-fat sources.",
    "Aim for ~30 g fibre a day and five portions of veg/fruit.",
]


def _pick(items: list, date: str, salt: str):
    seed = int(hashlib.md5(f"{date}:{salt}".encode()).hexdigest(), 16)
    name, kcal, fibre, why = items[seed % len(items)]
    return {"name": name, "kcal": kcal, "fibre_g": fibre, "why": why}


def meal_of_the_day(date: str) -> dict:
    """Deterministic-per-day heart-healthy plate + the hero 'meal of the day'."""
    breakfast = {**_pick(_BREAKFAST, date, "b"), "meal_type": "breakfast"}
    lunch = {**_pick(_LUNCH, date, "l"), "meal_type": "lunch"}
    dinner = {**_pick(_DINNER, date, "d"), "meal_type": "dinner"}
    snack = {**_pick(_SNACK, date, "s"), "meal_type": "snack"}
    # Hero = the midday main (Spanish main meal); alternate to dinner on odd days.
    seed = int(hashlib.md5(date.encode()).hexdigest(), 16)
    hero = lunch if seed % 2 == 0 else dinner
    total_fibre = sum(m["fibre_g"] for m in (breakfast, lunch, dinner, snack))
    tip = TIPS[seed % len(TIPS)]
    return {
        "date": date,
        "focus": "Heart-healthy (lower cholesterol)",
        "hero": hero,
        "plate": [breakfast, lunch, dinner, snack],
        "total_fibre_g": total_fibre,
        "tip": tip,
    }


def guidance_directive() -> str:
    """One-liner injected into the AI meal-planner / coach prompts so their
    suggestions also respect the cholesterol goal."""
    return (
        "I also have elevated LDL/cholesterol, so keep saturated fat low, avoid "
        "processed/fried foods and pastries, prioritise soluble fibre (oats, "
        "legumes, fruit, veg) and use unsaturated fats (olive oil, nuts, avocado, "
        "oily fish) — heart-healthy AND lean."
    )
