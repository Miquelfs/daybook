"""
Country-name normalization shared by the locations API and trip detection.
Nominatim returns local-language country names; map them to English.
"""

COUNTRY_EN: dict[str, str] = {
    "España": "Spain",
    "Éire / Ireland": "Ireland",
    "México": "Mexico",
    "Lëtzebuerg": "Luxembourg",
    "Maroc ⵍⵎⵖⵔⵉⴱ المغرب": "Morocco",
    "België / Belgique / Belgien": "Belgium",
    "Magyarország": "Hungary",
    "Österreich": "Austria",
    "Civitas Vaticana - Città del Vaticano": "Vatican City",
    "България": "Bulgaria",
    "Ελλάς": "Greece",
    "România": "Romania",
    "Česko": "Czech Republic",
    "Slovensko": "Slovakia",
    "Hrvatska": "Croatia",
    "Slovenija": "Slovenia",
    "Schweiz/Suisse/Svizzera/Svizra": "Switzerland",
    "Nederland": "Netherlands",
    "Polska": "Poland",
    "Türkiye": "Turkey",
    "Россия": "Russia",
    "日本": "Japan",
    "中国": "China",
    # Scandinavian local names (appear when Overland tracks are geocoded there)
    "Norge": "Norway",
    "Danmark": "Denmark",
    "Sverige": "Sweden",
    "Suomi / Finland": "Finland",
    "Deutschland": "Germany",
    "Italia": "Italy",
    "Frankreich": "France",
    "Norwegen": "Norway",
    "Eesti": "Estonia",
    "Lietuva": "Lithuania",
    "Latvija": "Latvia",
    "Shqipëria": "Albania",
    "Ísland": "Iceland",
    "Srbija / Србија": "Serbia",
    "Bosna i Hercegovina / Босна и Херцеговина": "Bosnia and Herzegovina",
    "Crna Gora / Црна Гора": "Montenegro",
    "Северна Македонија": "North Macedonia",
    "Україна": "Ukraine",
    "الإمارات العربية المتحدة": "United Arab Emirates",
    "قطر": "Qatar",
    "ישראל": "Israel",
    "ประเทศไทย": "Thailand",
    "대한민국": "South Korea",
    "Việt Nam": "Vietnam",
    "Indonesia": "Indonesia",
    "Brasil": "Brazil",
    "Κύπρος - Kıbrıs": "Cyprus",
}


def to_english(country: str | None) -> str | None:
    if country is None:
        return None
    return COUNTRY_EN.get(country, country)
