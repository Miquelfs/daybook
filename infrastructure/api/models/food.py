from typing import Optional
from pydantic import BaseModel, Field


class FoodEntryIn(BaseModel):
    date: str = Field(description="YYYY-MM-DD")
    description: str
    meal_type: Optional[str] = None       # breakfast|lunch|dinner|snack|extra
    source: str = "text"                  # text|photo|preset
    kcal: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    sugar_g: float = 0
    ai_confidence: Optional[float] = None
    ai_raw_json: Optional[str] = None


class FoodEntryPatch(BaseModel):
    date: Optional[str] = None
    description: Optional[str] = None
    meal_type: Optional[str] = None
    source: Optional[str] = None
    kcal: Optional[float] = None
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None
    sugar_g: Optional[float] = None
    ai_confidence: Optional[float] = None
    ai_raw_json: Optional[str] = None


class FoodEntryOut(BaseModel):
    id: int
    date: str
    description: str
    meal_type: Optional[str]
    source: str
    photo_path: Optional[str]
    photo_url: Optional[str]
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    sugar_g: float
    ai_confidence: Optional[float]
    logged_at: str
    created_at: str
    updated_at: str


class CrewMealPreset(BaseModel):
    id: int
    name: str
    category: str
    meal_type: Optional[str]
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    weight_g: Optional[float]
    location: str


class FoodTargetIn(BaseModel):
    """Manual override. effective_date defaults to today server-side if omitted."""
    effective_date: Optional[str] = None
    target_kcal: float
    protein_g: float
    maintenance_kcal: Optional[float] = None
    deficit_kcal: Optional[float] = None
    basis_weight_kg: Optional[float] = None
    notes: Optional[str] = None
