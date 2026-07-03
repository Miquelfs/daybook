from domains.training.plan_templates.running_half_marathon_balanced import RUNNING_HALF_MARATHON_BALANCED_TEMPLATE
from domains.training.plan_templates.running_half_marathon_polarized import RUNNING_HALF_MARATHON_POLARIZED_TEMPLATE
from domains.training.plan_templates.running_marathon_balanced import RUNNING_MARATHON_BALANCED_TEMPLATE
from domains.training.plan_templates.running_marathon_polarized import RUNNING_MARATHON_POLARIZED_TEMPLATE
from domains.training.plan_templates.triathlon_olympic import OLYMPIC_TRIATHLON_TEMPLATE
from domains.training.plan_templates.half_ironman_balanced import HALF_IRONMAN_BALANCED_TEMPLATE
from domains.training.plan_templates.half_ironman_polarized import HALF_IRONMAN_POLARIZED_TEMPLATE
from domains.training.plan_templates.ironman_balanced import IRONMAN_BALANCED_TEMPLATE
from domains.training.plan_templates.ironman_polarized import IRONMAN_POLARIZED_TEMPLATE
from domains.training.plan_templates.cycling_gran_fondo_100 import CYCLING_GRAN_FONDO_100_TEMPLATE
from domains.training.plan_templates.cycling_gran_fondo_160 import CYCLING_GRAN_FONDO_160_TEMPLATE

TEMPLATES = {
    "half_marathon_balanced":   RUNNING_HALF_MARATHON_BALANCED_TEMPLATE,
    "half_marathon_polarized":  RUNNING_HALF_MARATHON_POLARIZED_TEMPLATE,
    "marathon_balanced":        RUNNING_MARATHON_BALANCED_TEMPLATE,
    "marathon_polarized":       RUNNING_MARATHON_POLARIZED_TEMPLATE,
    "olympic_tri":              OLYMPIC_TRIATHLON_TEMPLATE,
    "half_ironman_balanced":    HALF_IRONMAN_BALANCED_TEMPLATE,
    "half_ironman_polarized":   HALF_IRONMAN_POLARIZED_TEMPLATE,
    "ironman_balanced":         IRONMAN_BALANCED_TEMPLATE,
    "ironman_polarized":        IRONMAN_POLARIZED_TEMPLATE,
    "gran_fondo_100":           CYCLING_GRAN_FONDO_100_TEMPLATE,
    "gran_fondo_160":           CYCLING_GRAN_FONDO_160_TEMPLATE,
}

RACE_TYPE_WEEKS = {
    "half_marathon":  14,
    "marathon":       16,
    "olympic_tri":    14,
    "half_ironman":   20,
    "ironman":        30,
    "gran_fondo_100": 12,
    "gran_fondo_160": 16,
}

RACE_TYPE_VARIANTS = {
    "half_marathon":  ["balanced", "polarized"],
    "marathon":       ["balanced", "polarized"],
    "olympic_tri":    ["balanced"],
    "half_ironman":   ["balanced", "polarized"],
    "ironman":        ["balanced", "polarized"],
    "gran_fondo_100": ["balanced"],
    "gran_fondo_160": ["balanced"],
}

RACE_TYPE_DISCIPLINES = {
    "half_marathon":  ["run"],
    "marathon":       ["run"],
    "olympic_tri":    ["run", "ride", "swim"],
    "half_ironman":   ["run", "ride", "swim"],
    "ironman":        ["run", "ride", "swim"],
    "gran_fondo_100": ["ride"],
    "gran_fondo_160": ["ride"],
}


def get_template_key(race_type: str, variant: str) -> str:
    if race_type in ("olympic_tri", "gran_fondo_100", "gran_fondo_160"):
        return race_type
    return f"{race_type}_{variant}"
